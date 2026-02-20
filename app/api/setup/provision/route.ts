import { NextRequest, NextResponse } from 'next/server';

// ─── Helper: ottieni token via client credentials (valida le credenziali) ──────

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
        const desc = err.error_description || err.error || res.statusText;
        throw new Error(`Credenziali non valide: ${desc}`);
    }
    return (await res.json()).access_token as string;
}

// ─── Aggiornamento Azure App Service via Managed Identity ─────────────────────

async function tryUpdateAppService(settings: Record<string, string>): Promise<boolean> {
    try {
        const resourceGroup = process.env.AZURE_RESOURCE_GROUP || 'RG-AutoMatTuner';
        const webAppName = process.env.WEBSITE_SITE_NAME || 'app-meteora-intuneget';
        const subscriptionId = process.env.WEBSITE_OWNER_NAME?.split('+')[0] || '';
        if (!subscriptionId || !process.env.IDENTITY_ENDPOINT) return false;

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

        // Riavvia il container
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
            return NextResponse.json(
                { error: 'clientId, clientSecret e tenantId sono obbligatori' },
                { status: 400 }
            );
        }

        const appUrlClean = (appUrl || process.env.NEXT_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

        // ── 1. Valida credenziali ottenendo un token ───────────────────────────
        // Se le credenziali sono sbagliate, questo fallisce con un errore chiaro.
        console.log('[setup/provision] Validando credenziali...');
        await getClientCredentialsToken(tenantId, clientId, clientSecret);
        console.log('[setup/provision] Credenziali valide.');

        // ── 2. Prepara le env vars da impostare ───────────────────────────────
        const settingsToSet: Record<string, string> = {
            NEXT_PUBLIC_AZURE_AD_CLIENT_ID: clientId,
            AZURE_AD_CLIENT_SECRET: clientSecret,
            AZURE_CLIENT_SECRET: clientSecret,
            AZURE_AD_TENANT_ID: tenantId,
            AZURE_TENANT_ID: tenantId,
            NEXT_PUBLIC_URL: appUrlClean,
        };

        // ── 3. Tenta aggiornamento automatico via Managed Identity ────────────
        const autoUpdated = await tryUpdateAppService(settingsToSet);

        if (autoUpdated) {
            console.log('[setup/provision] Env vars aggiornate automaticamente su App Service.');
            return NextResponse.json({ clientId, tenantId, autoUpdated: true });
        }

        // ── 4. Fallback: genera comando az da eseguire manualmente ────────────
        const settingsArgs = Object.entries(settingsToSet)
            .map(([k, v]) => `    ${k}="${v}"`)
            .join(' ^\n');

        const azCmd = [
            'az webapp config appsettings set ^',
            '  --resource-group RG-AutoMatTuner ^',
            '  --name app-meteora-intuneget ^',
            '  --settings ^',
            settingsArgs,
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
