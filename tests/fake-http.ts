export function fakeHttp(handler) {
	const calls = [];
	const http = async (url) => {
		const u = new URL(url);
		calls.push(u);
		const r = handler(u);
		return {
			status: r.status ?? 200,
			json: () => r.body,
			text: () => r.text ?? JSON.stringify(r.body),
			arrayBuffer: () => r.bytes ?? new ArrayBuffer(0),
		};
	};
	return { http, calls };
}
