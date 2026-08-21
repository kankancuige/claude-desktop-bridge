export function createPitfallAdmin({pitfallService} = {}) {
    if (!pitfallService) throw new TypeError('Pitfall Admin 需要 Pitfall Service')
    return {
        list({projectKey, status = null, limit = 200} = {}) {
            return pitfallService.list(String(projectKey || ''), {statuses: status ? [status] : null, limit})
        },
        confirm(id, details = {}) {
            return pitfallService.transitionPitfall(id, 'confirmed', details)
        },
        ignore(id) {
            return pitfallService.transitionPitfall(id, 'retired')
        },
        archive(id) {
            return pitfallService.transitionPitfall(id, 'retired')
        },
        verify(id, evidence) {
            return pitfallService.verifyPitfallPrevention(id, evidence)
        },
    }
}
