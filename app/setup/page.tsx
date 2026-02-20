'use client';

import { useState } from 'react';

type SetupStep = 'form' | 'working' | 'success' | 'error' | 'manual';

interface ProvisionResult {
    clientId: string;
    tenantId: string;
    autoUpdated: boolean;
    manualSteps?: string[];
}

export default function SetupPage() {
    const [step, setStep] = useState<SetupStep>('form');
    const [error, setError] = useState('');
    const [result, setResult] = useState<ProvisionResult | null>(null);
    const [log, setLog] = useState<string[]>([]);

    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [tenantId, setTenantId] = useState('');

    const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStep('working');
        setError('');
        setLog([]);

        addLog('Connessione a Microsoft Graph con le credenziali fornite...');

        try {
            const res = await fetch('/api/setup/provision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: clientId.trim(),
                    clientSecret: clientSecret.trim(),
                    tenantId: tenantId.trim(),
                    appUrl: window.location.origin,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `Errore ${res.status}`);
            }

            setResult(data);
            addLog('✓ Token ottenuto da Microsoft Graph.');
            addLog('✓ Redirect URI verificati e aggiornati.');
            addLog('✓ Permessi Intune verificati.');

            if (data.autoUpdated) {
                addLog('✓ Variabili d\'ambiente aggiornate su Azure App Service.');
                addLog('✓ Container in riavvio...');
                setStep('success');
            } else {
                addLog('⚠ Aggiornamento automatico non disponibile — segui i passaggi manuali.');
                setStep('manual');
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
            setStep('error');
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-blue-950 to-gray-950 flex items-center justify-center p-4">
            <div className="w-full max-w-xl">

                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600/20 border border-blue-500/30 mb-4">
                        <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                        </svg>
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Configurazione IntuneGet</h1>
                    <p className="text-gray-400 text-sm">
                        Inserisci le credenziali della tua App Registration Entra ID
                    </p>
                </div>

                <div className="bg-gray-900/70 backdrop-blur border border-gray-700/50 rounded-2xl p-8 shadow-2xl">

                    {/* FORM */}
                    {step === 'form' && (
                        <form onSubmit={handleSubmit} className="space-y-5">

                            <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3 text-xs text-blue-300">
                                Recupera questi valori da <strong>Entra ID → App registrations → la tua app → Overview</strong>
                            </div>

                            <div>
                                <label className="block text-gray-300 text-sm font-medium mb-1.5">
                                    Application (Client) ID
                                </label>
                                <input
                                    type="text"
                                    value={clientId}
                                    onChange={(e) => setClientId(e.target.value)}
                                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                    required
                                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white text-sm
                    placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 font-mono"
                                />
                            </div>

                            <div>
                                <label className="block text-gray-300 text-sm font-medium mb-1.5">
                                    Tenant ID
                                </label>
                                <input
                                    type="text"
                                    value={tenantId}
                                    onChange={(e) => setTenantId(e.target.value)}
                                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                    required
                                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white text-sm
                    placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 font-mono"
                                />
                            </div>

                            <div>
                                <label className="block text-gray-300 text-sm font-medium mb-1.5">
                                    Client Secret
                                </label>
                                <input
                                    type="password"
                                    value={clientSecret}
                                    onChange={(e) => setClientSecret(e.target.value)}
                                    placeholder="Il valore del secret (non l'ID)"
                                    required
                                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2.5 text-white text-sm
                    placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                                />
                                <p className="text-gray-500 text-xs mt-1">
                                    Certificates &amp; secrets → valore visibile solo alla creazione
                                </p>
                            </div>

                            <button
                                type="submit"
                                className="w-full py-3 rounded-xl font-semibold text-white
                  bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500
                  transition-all duration-200 shadow-lg shadow-blue-900/30"
                            >
                                Configura IntuneGet →
                            </button>

                            <p className="text-center text-xs text-gray-500">
                                Non hai ancora un&apos;App Registration?{' '}
                                <a
                                    href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:text-blue-300 underline"
                                >
                                    Creane una sul portale Azure →
                                </a>
                            </p>
                        </form>
                    )}

                    {/* WORKING */}
                    {step === 'working' && (
                        <div className="text-center py-6">
                            <svg className="animate-spin w-12 h-12 text-blue-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            <h2 className="text-white font-semibold text-lg mb-4">Configurazione in corso...</h2>
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
                            <button
                                onClick={() => { setTimeout(() => { window.location.href = '/'; }, 3000); }}
                                className="mt-6 w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold transition-colors"
                            >
                                Vai all&apos;app →
                            </button>
                        </div>
                    )}

                    {/* MANUAL */}
                    {step === 'manual' && result && (
                        <div>
                            <div className="text-center mb-6">
                                <div className="text-5xl mb-3">⚙️</div>
                                <h2 className="text-white font-bold text-xl">Quasi fatto!</h2>
                                <p className="text-gray-400 text-sm mt-1">
                                    Esegui questo comando PowerShell, poi riavvia il container:
                                </p>
                            </div>
                            <LogBox logs={log} />
                            {result.manualSteps && (
                                <div className="mt-4 bg-gray-800/60 border border-gray-700/40 rounded-lg p-4 overflow-x-auto">
                                    <pre className="text-green-400 text-xs font-mono whitespace-pre">{result.manualSteps.join('\n')}</pre>
                                </div>
                            )}
                            <button
                                onClick={() => { if (result.manualSteps) { navigator.clipboard?.writeText(result.manualSteps.join('\n')); } }}
                                className="mt-3 w-full py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
                            >
                                📋 Copia comando
                            </button>
                        </div>
                    )}

                    {/* ERROR */}
                    {step === 'error' && (
                        <div className="text-center py-4">
                            <div className="text-5xl mb-4">❌</div>
                            <h2 className="text-white font-bold text-lg mb-2">Errore</h2>
                            <p className="text-red-400 text-sm bg-red-900/20 border border-red-700/30 rounded-lg p-3 mb-6 text-left font-mono break-all">
                                {error}
                            </p>
                            <LogBox logs={log} />
                            <button
                                onClick={() => { setStep('form'); setLog([]); setError(''); }}
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
        <div className="bg-gray-950/80 border border-gray-700/40 rounded-lg p-3 mb-4 space-y-1 max-h-36 overflow-y-auto">
            {logs.map((l, i) => (
                <p key={i} className="text-gray-300 text-xs font-mono">{l}</p>
            ))}
        </div>
    );
}

function InfoBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-gray-800/60 border border-gray-700/40 rounded-lg p-3 flex items-center justify-between gap-2 mb-2">
            <div className="min-w-0">
                <p className="text-gray-400 text-xs">{label}</p>
                <p className="text-white text-xs font-mono truncate">{value}</p>
            </div>
            <button onClick={() => navigator.clipboard?.writeText(value)}
                className="text-gray-400 hover:text-white transition-colors shrink-0" title="Copia">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            </button>
        </div>
    );
}
