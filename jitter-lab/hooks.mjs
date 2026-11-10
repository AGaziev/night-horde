const ROOT = new URL('../app/public/', import.meta.url);
export async function resolve(spec, ctx, next) {
	if (spec.startsWith('/shared/') || spec.startsWith('/js/')) return next(new URL(spec.slice(1), ROOT).href, ctx);
	return next(spec, ctx);
}
