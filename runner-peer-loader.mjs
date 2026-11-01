import { pathToFileURL } from "node:url";

let aliases = {};
let nativeRunner = false;
let compiledRunner = false;
let packageRootUrl;
const redirected = new Set([
	"@earendil-works/pi-tui",
]);

export function initialize(data) {
	aliases = data?.aliases ?? {};
	nativeRunner = data?.nativeRunner === true;
	compiledRunner = data?.compiledRunner === true;
	packageRootUrl = data?.packageRootUrl;
}

export function resolve(specifier, context, nextResolve) {
	const packageImport = typeof packageRootUrl === "string" && context.parentURL?.startsWith(packageRootUrl) === true;
	const isPiPeer = specifier.startsWith("@earendil-works/");
	const shouldRedirect = (packageImport && (!compiledRunner || nativeRunner)) || (nativeRunner && !compiledRunner && isPiPeer) || redirected.has(specifier);
	if (shouldRedirect && aliases[specifier]) {
		return nextResolve(pathToFileURL(aliases[specifier]).href, context);
	}
	return nextResolve(specifier, context);
}
