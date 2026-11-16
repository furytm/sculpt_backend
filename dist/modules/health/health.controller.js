// Controllers are HTTP only - request in, response out. Nothing here reaches
// past this file into a database or an external service directly; a real
// module's controller calls its own service.ts for that.
export function getHealth(_req, res) {
    res.json({ data: { status: 'ok' } });
}
//# sourceMappingURL=health.controller.js.map