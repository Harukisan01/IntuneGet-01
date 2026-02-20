import { NextRequest, NextResponse } from 'next/server';

// ─── Tipi ─────────────────────────────────────────────────────────────────────

interface GraphApp {
    id: string;
    appId: string;
}

interface GraphSP {
    id: string;
}

interface GraphSecret {
    secretText: string;
    endDateTime: string;
}

// ─── Costanti ─────────────────────────────────────────────────────────────────

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_SP_ID = '00000003-0000-0000-c000-000000000000';

// IDs fissi dei permessi (uguali su tutti i tenant Azure commerciali)
const PERM_IDS = {
    DeviceManagementAppsReadWriteAll: '78145de6-330d-4800-a6ce-494ff2d33d07',
    DeviceManagementManagedDevicesReadAll: '314874da-47d6-4978-88dc-cf0d37f0bb82',
    UserRead: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d',
    OpenId: '37f7f235-527c-4136-accd-4a02d197296e',
    Profile: '14dad69e-099b-42c9-810b-d002981feec1',
};

// ─── Helper: ottieni token via client credentials ─────────────────────────────

async function getClientCredentialsToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'https://graph.microsoft.com/.default',
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Token error: ${err.error_description || err.error || res.statusText}`);
    }
    const data = await res.json();
    return data.access_token as string;
}

// ─── Helper Graph ──────────────────────────────────────────────────────────────

async function graphCall<T = unknown>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
        const msg = err?.error?.message || err?.error?.code || res.statusText;
        throw new Error(`Graph ${method} ${path} → ${res.status}: ${msg}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

// ─── Aggiornamento Azure App Service via Managed Identity ─────────────────────

async function tryUpdateAppService(settings: Record<string, string>): Promise<boolean> {
    try {
        const resourceGroup = process.env.AZURE_RESOURCE_GROUP || 'RG-AutoMatTuner';
        const webAppName = process.env.WEBSITE_SITE_NAME || 'app-meteora-intuneget';
        const subscriptionId = process.env.WEBSITE_OWNER_NAME?.split('+')[0] || '';
        if (!subscriptionId) return false;

        const miRes = await fetch(
            `${process.env.IDENTITY_ENDPOINT}?resource=https://management.azure.com/&api-version=2019-08-01`,
            { headers: { 'X-IDENTITY-HEADER': process.env.IDENTITY_HEADER || '' } }
        );
        if (!miRes.ok) return false;
        const miToken = (await miRes.json()).access_token as string;

        const apiVersion = '2023-01-01';
        const baseUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${webAppName}`;

        const currentRes = await fetch(`${baseUrl}/config/appsettings/list?api-version=${apiVersion}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${miToken}`, 'Content-Type': 'application/json' },
            body: '{}',
        });
        const current = await currentRes.json();
        const merged = { ...current.properties, ...settings };

        const updateRes = await fetch(`${baseUrl}/config/appsettings?api-version=${apiVersion}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${miToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ properties: merged }),
        });
        if (!updateRes.ok) return false;

        await fetch(`${baseUrl}/restart?api-version=${apiVersion}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${miToken}` },
        });
        return true;
    } catch {
        return false;
    }
}

// ─── API Route ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { clientId, clientSecret, tenantId, appUrl } = body as {
            clientId: string;
            clientSecret: string;
            tenantId: string;
            appUrl: string;
        };

        if (!clientId || !clientSecret || !tenantId) {
            return NextResponse.json({ error: 'clientId, clientSecret e tenantId sono obbligatori' }, { status: 400 });
        }

        const appUrlClean = appUrl || process.env.NEXT_PUBLIC_URL || 'http://localhost:3000';

        // ── 1. Ottieni token via client credentials ────────────────────────────
        console.log('[setup/provision] Ottenendo token via client credentials...');
        const token = await getClientCredentialsToken(tenantId, clientId, clientSecret);
        console.log('[setup/provision] Token ottenuto.');

        // ── 2. Verifica che l'app esista e recupera i dati ────────────────────
        const appData = await graphCall<GraphApp>(token, 'GET', `/applications?$filter=appId eq '${clientId}'&$select=id,appId`
        ).then((r: unknown) => {
            const res = r as { value: GraphApp[] };
            return res.value[0] || null;
        });

        if (!appData) {
            return NextResponse.json({ error: `App Registration con clientId '${clientId}' non trovata nel tenant '${tenantId}'` }, { status: 404 });
        }

        console.log('[setup/provision] App Registration trovata:', appData.id);

        // ── 3. Aggiorna redirect URI (aggiungi se mancante) ───────────────────
        const currentApp = await graphCall<{ spa?: { redirectUris: string[] }; signInAudience: string }>(
            token, 'GET', `/applications/${appData.id}?$select=spa,signInAudience`
        );
        const existingUris = currentApp.spa?.redirectUris || [];
        const requiredUris = ['http://localhost:3000', appUrlClean];
        const missingUris = requiredUris.filter((u) => !existingUris.includes(u));

        if (missingUris.length > 0 || currentApp.signInAudience !== 'AzureADMultipleOrgs') {
            await graphCall(token, 'PATCH', `/applications/${appData.id}`, {
                signInAudience: 'AzureADMultipleOrgs',
                spa: { redirectUris: [...existingUris, ...missingUris] },
                requiredResourceAccess: [
                    {
                        resourceAppId: GRAPH_SP_ID,
                        resourceAccess: [
                            { id: PERM_IDS.DeviceManagementAppsReadWriteAll, type: 'Role' },
                            { id: PERM_IDS.DeviceManagementManagedDevicesReadAll, type: 'Role' },
                            { id: PERM_IDS.UserRead, type: 'Scope' },
                            { id: PERM_IDS.OpenId, type: 'Scope' },
                            { id: PERM_IDS.Profile, type: 'Scope' },
                        ],
                    },
                ],
            });
            console.log('[setup/provision] App Registration aggiornata (redirect URIs, permessi, audience).');
        }

        // ── 4. Assicura Service Principal e Admin Consent ─────────────────────
        let sp: GraphSP;
        const existingSPs = await graphCall<{ value: GraphSP[] }>(
            token, 'GET', `/servicePrincipals?$filter=appId eq '${clientId}'&$select=id`
        );
        if (existingSPs.value.length > 0) {
            sp = existingSPs.value[0];
        } else {
            sp = await graphCall<GraphSP>(token, 'POST', '/servicePrincipals', { appId: clientId });
            await new Promise((r) => setTimeout(r, 3000));
        }

        const graphSPRes = await graphCall<{ id: string }>(token, 'GET', `/servicePrincipals(appId='${GRAPH_SP_ID}')`);
        const graphSPObjId = graphSPRes.id;

        const existingGrants = await graphCall<{ value: { appRoleId: string }[] }>(
            token, 'GET', `/servicePrincipals/${sp.id}/appRoleAssignments`
        );
        const alreadyGranted = new Set(existingGrants.value.map((g) => g.appRoleId));

        for (const roleId of [PERM_IDS.DeviceManagementAppsReadWriteAll, PERM_IDS.DeviceManagementManagedDevicesReadAll]) {
            if (!alreadyGranted.has(roleId)) {
                await graphCall(token, 'POST', `/servicePrincipals/${sp.id}/appRoleAssignments`, {
                    principalId: sp.id,
                    resourceId: graphSPObjId,
                    appRoleId: roleId,
                });
            }
        }
        console.log('[setup/provision] Admin Consent verificato/applicato.');

        // ── 5. Genera nuovo Client Secret ─────────────────────────────────────
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 24);
        const newSecret = await graphCall<GraphSecret>(token, 'POST', `/applications/${appData.id}/addPassword`, {
            passwordCredential: {
                displayName: `IntuneGet-Setup-${new Date().toISOString().slice(0, 10)}`,
                endDateTime: expiry.toISOString(),
            },
        });
        const newClientSecret = newSecret.secretText;
        console.log('[setup/provision] Nuovo Client Secret generato.');

        // ── 6. Tenta aggiornamento automatico App Service ────────────────────
        const settingsToSet: Record<string, string> = {
            NEXT_PUBLIC_AZURE_AD_CLIENT_ID: clientId,
            AZURE_AD_CLIENT_SECRET: newClientSecret,
            AZURE_CLIENT_SECRET: newClientSecret,
            AZURE_AD_TENANT_ID: tenantId,
            AZURE_TENANT_ID: tenantId,
            NEXT_PUBLIC_URL: appUrlClean,
        };

        const autoUpdated = await tryUpdateAppService(settingsToSet);

        if (autoUpdated) {
            return NextResponse.json({ clientId, tenantId, autoUpdated: true });
        }

        // Fallback manuale
        const azCmd = [
            `az webapp config appsettings set \\`,
            `  --resource-group RG-AutoMatTuner \\`,
            `  --name app-meteora-intuneget \\`,
            `  --settings \\`,
            ...Object.entries(settingsToSet).map(([k, v]) => `    ${k}="${v}"`),
        ].join('\n');

        return NextResponse.json({
            clientId,
            tenantId,
            autoUpdated: false,
            manualSteps: [azCmd],
        });

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[setup/provision] ERROR:', msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
