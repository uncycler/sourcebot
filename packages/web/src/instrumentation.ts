export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { startMetricsServer } = await import('./metricsServer');
        startMetricsServer();

        const { startHttpMetrics } = await import('./httpMetrics');
        startHttpMetrics();

        const { initialize } = await import('./initialize');
        await initialize();
    }
}
