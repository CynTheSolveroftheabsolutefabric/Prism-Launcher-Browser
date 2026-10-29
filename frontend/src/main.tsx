import "./prism.css";
import { gameChannel, isGamePage } from "./launch";

function showFatal(message: string) {
	const existing = document.querySelector(".boot-fatal");
	if (existing) existing.remove();
	const el = document.createElement("div");
	el.className = "boot-fatal";
	el.textContent = message;
	document.body.append(el);
}

const style = document.createElement("style");
style.textContent = `.boot-fatal { position: fixed; inset: auto 1rem 1rem; z-index: 9999;
	background: #3a1512; color: #ffd7d5; border: 1px solid #ff5555; border-radius: 8px;
	font: 500 .85rem/1.5 system-ui, sans-serif; padding: .9rem 1.1rem; overflow-wrap: anywhere; }`;
document.head.append(style);

// One bundle, two pages: the Prism-style launcher, and the game tab opened by
// it. The game tab is the only page that loads the .NET/IKVM runtime.
if (isGamePage()) {
	try {
		await import("./game");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		showFatal(`The game runtime failed to load: ${message}`);
		gameChannel()?.postMessage({ type: "exit", code: 1 });
	}
} else {
	addEventListener("error", (e) =>
		showFatal(`The launcher failed to load: ${e.message ?? "unknown error"}`)
	);
	addEventListener("unhandledrejection", (e) =>
		showFatal(`The launcher failed to load: ${String((e as PromiseRejectionEvent).reason)}`)
	);
	try {
		await import("./launcher");
	} catch (error) {
		showFatal(
			`The launcher failed to load: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
