'use client';

import { useState, useCallback } from 'react';
import { PublicClientApplication } from '@azure/msal-browser';

// Scopes elevati necessari per creare App Registration
const SETUP_SCOPES = [
    'Application.ReadWrite.All',
    'AppRoleAssignment.ReadWrite.All',
    'openid',
    'profile',
];

type SetupStep = 'idle' | 'authenticating' | 'provisioning' | 'success' | 'error' | 'manual';

interface ProvisionResult {
    clientId: string;
    tenantId: string;
    secretHint: string;
    autoUpdated: boolean;
    manualSteps?: string[];
}

export default function SetupPage() {
    const [step, setStep] = useState<SetupStep>('idle');
    const [error, setError] = useState<string>('');
    const [result, setResult] = useState<ProvisionResult | null>(null);
    const [log, setLog] = useState<string[]>([]);

    const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

    const handleSetup = useCallback(async () => {
        setStep('authenticating');
        setError('');
        setLog([]);

        try {
            // ── 1. LOGIN MSAL con scope elevati ─────────────────────────────────
            addLog('Avvio autenticazione Microsoft con permessi di amministratore...');

            const msalApp = new PublicClientApplication({
                auth: {
                    clientId: '04b07795-8ddb-461a-bbee-02f9e1bf7b46', // Azure CLI public client (universale)
                    authority: 'https://login.microsoftonline.com/organizations',
                    redirectUri: window.location.origin,
                },
                cache: { cacheLocation: 'sessionStorage' },
            });

            await msalApp.initialize();

            let tokenResponse;
            try {
                tokenResponse = await msalApp.acquireTokenPopup({
                    scopes: SETUP_SCOPES,
                    prompt: 'select_account',
                });
            } catch (popupErr: unknown) {
                const msg = popupErr instanceof Error ? popupErr.message : String(popupErr);
                throw new Error(`Login annullato o fallito: ${msg}`);
            }

            const accessToken = tokenResponse.accessToken;
            addLog(`✓ Autenticato come: ${tokenResponse.account?.username}`);
            addLog(`  Tenant: ${tokenResponse.account?.tenantId}`);

            // ── 2. CHIAMA L'API DI PROVISIONING ────────────────────────────────
            setStep('provisioning');
            addLog('Avvio creazione App Registration su Entra ID...');

            const res = await fetch('/api/setup/provision', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    appUrl: window.location.origin,
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({ error: res.statusText }));
                throw new Error(errData.error || `Errore HTTP ${res.status}`);
            }

            const data: ProvisionResult = await res.json();
            setResult(data);

            if (data.autoUpdated) {
                addLog('✓ App Registration creata.');
                addLog('✓ Variabili d\'ambiente aggiornate su Azure App Service.');
                addLog('✓ Container in riavvio... (attendere 60 secondi)');
                setStep('success');
            } else {
                addLog('✓ App Registration creata.');
                addLog('⚠ Aggiornamento automatico non riuscito — segui i passaggi manuali.');
                setStep('manual');
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
            setStep('error');
        }
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-blue-950 to-gray-950 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl">

                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 mb-4">
                        <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.97 11.97 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                        </svg>
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Configurazione IntuneGet</h1>
                    <p className="text-gray-400 text-sm">
                        Prima configurazione — crea automaticamente l&apos;App Registration in Microsoft Entra ID
                    </p>
                </div>

                {/* Card principale */}
                <div className="bg-gray-900/70 backdrop-blur border border-gray-700/50 rounded-2xl p-8 shadow-2xl">

                    {/* IDLE: Descrizione + Bottone */}
                    {(step === 'idle' || step === 'authenticating') && (
                        <>
                            <div className="space-y-4 mb-8">
                                <h2 className="text-white font-semibold text-lg">Cosa verrà configurato</h2>

                                <div className="space-y-3">
                                    {[
                                        { icon: '🔐', title: 'App Registration Entra ID', desc: 'Tipo: multi-tenant, SPA — permette il login agli utenti Microsoft 365' },
                                        { icon: '📋', title: 'Permessi API', desc: 'DeviceManagementApps.ReadWrite.All e DeviceManagementManagedDevices.Read.All' },
                                        { icon: '✅', title: 'Admin Consent automatico', desc: 'I permessi Intune vengono approvati per il tuo tenant' },
                                        { icon: '🔑', title: 'Client Secret (24 mesi)', desc: 'Generato e iniettato automaticamente nelle variabili d\'ambiente' },
                                    ].map((item) => (
                                        <div key={item.title} className="flex gap-3 p-3 rounded-lg bg-gray-800/50 border border-gray-700/40">
                                            <span className="text-xl shrink-0">{item.icon}</span>
                                            <div>
                                                <p className="text-white text-sm font-medium">{item.title}</p>
                                                <p className="text-gray-400 text-xs mt-0.5">{item.desc}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="bg-amber-900/20 border border-amber-600/30 rounded-lg p-3 mt-4">
                                    <p className="text-amber-300 text-xs">
                                        ⚠️ Richiede accesso come <strong>Application Administrator</strong> o <strong>Global Administrator</strong> su Microsoft Entra ID.
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={handleSetup}
                                disabled={step === 'authenticating'}
                                className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-semibold text-white
                  bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200 shadow-lg shadow-blue-900/30"
                            >
                                {step === 'authenticating' ? (
                                    <>
                                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        Autenticazione in corso...
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" viewBox="0 0 21 21" fill="currentColor">
                                            <path d="M10.5 0L13.5 9H21L14.5 13.5L17.5 21L10.5 16L3.5 21L6.5 13.5L0 9H7.5L10.5 0Z" />
                                        </svg>
                                        Configura con Microsoft
                                    </>
                                )}
                            </button>
                        </>
                    )}

                    {/* PROVISIONING: Progress */}
                    {step === 'provisioning' && (
                        <div className="text-center py-4">
                            <div className="flex justify-center mb-6">
                                <svg className="animate-spin w-12 h-12 text-blue-400" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                            </div>
                            <h2 className="text-white font-semibold text-lg mb-4">Provisioning in corso...</h2>
                            <LogBox logs={log} />
                        </div>
                    )}

                    {/* SUCCESS */}
                    {step === 'success' && result && (
                        <div>
                            <div className="text-center mb-6">
                                <div className="text-5xl mb-3">✅</div>
                                <h2 className="text-white font-bold text-xl">Configurazione completata!</h2>
                                <p className="text-gray-400 text-sm mt-1">L&apos;app si riavvierà automaticamente tra ~60 secondi.</p>
                            </div>
                            <LogBox logs={log} />
                            <InfoBox label="Client ID" value={result.clientId} />
                            <InfoBox label="Tenant ID" value={result.tenantId} />
                            <div className="mt-6">
                                <button
                                    onClick={() => { setTimeout(() => window.location.href = '/', 1000); }}
                                    className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold transition-colors"
                                >
                                    Vai all&apos;app →
                                </button>
                            </div>
                        </div>
                    )}

                    {/* MANUAL: Passaggi manuali */}
                    {step === 'manual' && result && (
                        <div>
                            <div className="text-center mb-6">
                                <div className="text-5xl mb-3">⚙️</div>
                                <h2 className="text-white font-bold text-xl">App Registration creata!</h2>
                                <p className="text-gray-400 text-sm mt-1">
                                    Aggiorna queste variabili su <strong>Azure App Service → Environment Variables</strong>:
                                </p>
                            </div>
                            <LogBox logs={log} />
                            <div className="mt-4 space-y-2">
                                <InfoBox label="NEXT_PUBLIC_AZURE_AD_CLIENT_ID" value={result.clientId} />
                                <InfoBox label="AZURE_AD_CLIENT_SECRET" value="[nuovo secret — vedi log]" />
                                <InfoBox label="AZURE_CLIENT_SECRET" value="[stesso valore]" />
                                <InfoBox label="AZURE_TENANT_ID" value={result.tenantId} />
                            </div>
                            {result.manualSteps && (
                                <div className="mt-4 bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
                                    <p className="text-gray-300 text-xs font-mono whitespace-pre-wrap">{result.manualSteps.join('\n')}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ERROR */}
                    {step === 'error' && (
                        <div className="text-center py-4">
                            <div className="text-5xl mb-4">❌</div>
                            <h2 className="text-white font-bold text-lg mb-2">Errore durante il setup</h2>
                            <p className="text-red-400 text-sm bg-red-900/20 border border-red-700/30 rounded-lg p-3 mb-6 text-left font-mono">
                                {error}
                            </p>
                            <LogBox logs={log} />
                            <button
                                onClick={() => { setStep('idle'); setLog([]); setError(''); }}
                                className="mt-4 w-full py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-semibold transition-colors"
                            >
                                Riprova
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function LogBox({ logs }: { logs: string[] }) {
    if (logs.length === 0) return null;
    return (
        <div className="bg-gray-950/80 border border-gray-700/40 rounded-lg p-3 mb-4 space-y-1 max-h-40 overflow-y-auto">
            {logs.map((l, i) => (
                <p key={i} className="text-gray-300 text-xs font-mono">{l}</p>
            ))}
        </div>
    );
}

function InfoBox({ label, value }: { label: string; value: string }) {
    const copy = () => navigator.clipboard?.writeText(value);
    return (
        <div className="bg-gray-800/60 border border-gray-700/40 rounded-lg p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
                <p className="text-gray-400 text-xs">{label}</p>
                <p className="text-white text-xs font-mono truncate">{value}</p>
            </div>
            <button onClick={copy} className="text-gray-400 hover:text-white transition-colors shrink-0" title="Copia">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            </button>
        </div>
    );
}
