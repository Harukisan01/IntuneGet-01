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
    keyId: string;
    endDateTime: string;
}

interface GraphPermission {
    id: string;
}

// ─── Costanti ─────────────────────────────────────────────────────────────────

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_SP_ID = '00000003-0000-0000-c000-000000000000'; // Microsoft Graph

// IDs fissi dei permessi (uguali su tutti i tenant Azure commerciali)
const PERM_IDS = {
    // Application permissions (Role)
    DeviceManagementAppsReadWriteAll: '78145de6-330d-4800-a6ce-494ff2d33d07',
    DeviceManagementManagedDevicesReadAll: '314874da-47d6-4978-88dc-cf0d37f0bb82',
    // Delegated permissions (Scope)
    UserRead: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d',
    OpenId: '37f7f235-527c-4136-accd-4a02d197296e',
    Profile: '14dad69e-099b-42c9-810b-d002981feec1',
};

// ─── Helper Graph ──────────────────────────────────────────────────────────────

async function graphCall<T = unknown>(
    token: string,
    method: string,
    path: string,
    body?: unknown
): Promise<T> {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
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

        // Ottieni token Managed Identity per Azure Resource Manager
        const miRes = await fetch(
            `${process.env.IDENTITY_ENDPOINT}?resource=https://management.azure.com/&api-version=2019-08-01`,
            { headers: { 'X-IDENTITY-HEADER': process.env.IDENTITY_HEADER || '' } }
        );
        if (!miRes.ok) return false;
        const miToken = (await miRes.json()).access_token as string;

        // Leggi settings attuali
        const apiVersion = '2023-01-01';
        const baseUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${webAppName}`;

        const currentRes = await fetch(
            `${baseUrl}/config/appsettings/list?api-version=${apiVersion}`,
            { method: 'POST', headers: { Authorization: `Bearer ${miToken}`, 'Content-Type': 'application/json' }, body: '{}' }
        );
        const current = await currentRes.json();
        const merged = { ...current.properties, ...settings };

        // Aggiorna
        const updateRes = await fetch(
            `${baseUrl}/config/appsettings?api-version=${apiVersion}`,
            {
                method: 'PUT',
                headers: { Authorization: `Bearer ${miToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ properties: merged }),
            }
        );
        if (!updateRes.ok) return false;

        // Riavvia
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
        // ── 0. Estrai e valida il token admin ───────────────────────────────────
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Token mancante' }, { status: 401 });
        }
        const token = authHeader.slice(7);

        const body = await request.json().catch(() => ({}));
        const appUrl: string = body.appUrl || process.env.NEXT_PUBLIC_URL || 'http://localhost:3000';

        // ── 1. Recupera tenant dell'admin dal token ─────────────────────────────
        const meRes = await graphCall<{ id: string; userPrincipalName: string }>(token, 'GET', '/me');
        console.log('[setup/provision] Admin:', meRes.userPrincipalName);

        // Tenant ID dal token JWT
        const tokenParts = token.split('.');
        const tokenPayload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString());
        const tenantId: string = tokenPayload.tid;

        // ── 2. Recupera Service Principal di Microsoft Graph ────────────────────
        const graphSPRes = await graphCall<{ id: string }>(token, 'GET', `/servicePrincipals(appId='${GRAPH_SP_ID}')`);
        const graphSPObjId = graphSPRes.id;

        // ── 3. Controlla se App Registration esiste già ─────────────────────────
        const appName = `IntuneGet-Meteora`;
        const existingApps = await graphCall<{ value: GraphApp[] }>(
            token, 'GET', `/applications?$filter=displayName eq '${appName}'&$select=id,appId`
        );

        let app: GraphApp;
        let isNew = false;

        if (existingApps.value.length > 0) {
            console.log('[setup/provision] App Registration esistente trovata.');
            app = existingApps.value[0];
        } else {
            // ── 4. Crea App Registration ─────────────────────────────────────────
            console.log('[setup/provision] Creo nuova App Registration...');
            isNew = true;

            app = await graphCall<GraphApp>(token, 'POST', '/applications', {
                displayName: appName,
                signInAudience: 'AzureADMultipleOrgs',
                spa: {
                    redirectUris: ['http://localhost:3000', appUrl],
                },
                requiredResourceAccess: [
                    {
                        resourceAppId: GRAPH_SP_ID,
                        resourceAccess: [
                            // Application permissions
                            { id: PERM_IDS.DeviceManagementAppsReadWriteAll, type: 'Role' },
                            { id: PERM_IDS.DeviceManagementManagedDevicesReadAll, type: 'Role' },
                            // Delegated permissions
                            { id: PERM_IDS.UserRead, type: 'Scope' },
                            { id: PERM_IDS.OpenId, type: 'Scope' },
                            { id: PERM_IDS.Profile, type: 'Scope' },
                        ],
                    },
                ],
            });

            console.log('[setup/provision] App creata, appId:', app.appId);
        }

        // ── 5. Aggiorna redirect URI se già esiste (aggiungi se mancante) ───────
        if (!isNew) {
            const currentApp = await graphCall<{ spa?: { redirectUris: string[] } }>(
                token, 'GET', `/applications/${app.id}?$select=spa`
            );
            const existing = currentApp.spa?.redirectUris || [];
            const toAdd = [appUrl, 'http://localhost:3000'].filter((u) => !existing.includes(u));
            if (toAdd.length > 0) {
                await graphCall(token, 'PATCH', `/applications/${app.id}`, {
                    spa: { redirectUris: [...existing, ...toAdd] },
                });
            }
        }

        // ── 6. Crea Service Principal ────────────────────────────────────────────
        let sp: GraphSP;
        const existingSPs = await graphCall<{ value: GraphSP[] }>(
            token, 'GET', `/servicePrincipals?$filter=appId eq '${app.appId}'&$select=id`
        );

        if (existingSPs.value.length > 0) {
            sp = existingSPs.value[0];
            console.log('[setup/provision] Service Principal esistente:', sp.id);
        } else {
            sp = await graphCall<GraphSP>(token, 'POST', '/servicePrincipals', { appId: app.appId });
            console.log('[setup/provision] Service Principal creato:', sp.id);
            // Attendi propagazione
            await new Promise((r) => setTimeout(r, 3000));
        }

        // ── 7. Admin Consent — permessi applicativi ──────────────────────────────
        const roleIds = [
            PERM_IDS.DeviceManagementAppsReadWriteAll,
            PERM_IDS.DeviceManagementManagedDevicesReadAll,
        ];

        // Leggi consent già esistenti
        const existingGrants = await graphCall<{ value: { appRoleId: string }[] }>(
            token, 'GET', `/servicePrincipals/${sp.id}/appRoleAssignments`
        );
        const alreadyGranted = new Set(existingGrants.value.map((g) => g.appRoleId));

        for (const roleId of roleIds) {
            if (!alreadyGranted.has(roleId)) {
                await graphCall(token, 'POST', `/servicePrincipals/${sp.id}/appRoleAssignments`, {
                    principalId: sp.id,
                    resourceId: graphSPObjId,
                    appRoleId: roleId,
                });
                console.log('[setup/provision] Admin Consent applicato per:', roleId);
            }
        }

        // ── 8. Genera Client Secret ──────────────────────────────────────────────
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 24);

        const secretResult = await graphCall<GraphSecret>(
            token, 'POST', `/applications/${app.id}/addPassword`,
            {
                passwordCredential: {
                    displayName: `IntuneGet-AutoSetup-${new Date().toISOString().slice(0, 10)}`,
                    endDateTime: expiry.toISOString(),
                },
            }
        );

        const clientSecret = secretResult.secretText;
        console.log('[setup/provision] Client Secret creato, scade:', expiry.toISOString().slice(0, 10));

        // ── 9. Tenta aggiornamento automatico App Service ────────────────────────
        const settingsToSet: Record<string, string> = {
            NEXT_PUBLIC_AZURE_AD_CLIENT_ID: app.appId,
            AZURE_AD_CLIENT_SECRET: clientSecret,
            AZURE_CLIENT_SECRET: clientSecret,
            AZURE_AD_TENANT_ID: tenantId,
            AZURE_TENANT_ID: tenantId,
            NEXT_PUBLIC_URL: appUrl,
        };

        const autoUpdated = await tryUpdateAppService(settingsToSet);

        // ── 10. Risposta ─────────────────────────────────────────────────────────
        if (autoUpdated) {
            return NextResponse.json({
                clientId: app.appId,
                tenantId,
                secretHint: `${clientSecret.slice(0, 6)}...`,
                autoUpdated: true,
            });
        } else {
            // Fallback: istruzione manuale con il secret in chiaro (una sola volta)
            const azCmd = Object.entries(settingsToSet)
                .map(([k, v]) => `    ${k}=${v}`)
                .join(' \\\n');

            return NextResponse.json({
                clientId: app.appId,
                tenantId,
                secretHint: clientSecret, // mostrato solo nel fallback manuale
                autoUpdated: false,
                manualSteps: [
                    'Esegui questo comando (già fatto az login):',
                    '',
                    `az webapp config appsettings set \\`,
                    `  --resource-group RG-AutoMatTuner \\`,
                    `  --name app-meteora-intuneget \\`,
                    `  --settings \\`,
                    azCmd,
                ],
            });
        }

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[setup/provision] ERROR:', msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
