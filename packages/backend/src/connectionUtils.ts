
export function processPromiseResults<T>(
    results: PromiseSettledResult<T[]>[],
): T[] {
    return results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
    );
}

export function throwIfAnyFailed<T>(results: PromiseSettledResult<T>[]) {
    const failedResult = results.find(result => result.status === 'rejected');
    if (failedResult) {
        throw failedResult.reason;
    }
}
