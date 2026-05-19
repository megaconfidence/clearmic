import { AwsClient } from "aws4fetch";
import type { AppEnv } from "./types";

const BUCKET_NAME = "clearmic-audio";

export async function createPresignedPutUrl(
	env: AppEnv,
	key: string,
	expiresInSeconds: number,
	signedHeaders: HeadersInit,
): Promise<string> {
	const r2 = new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
	});

	const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET_NAME}/${encodeR2Key(key)}`);
	url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

	const signed = await r2.sign(new Request(url, { method: "PUT", headers: signedHeaders }), {
		aws: { signQuery: true },
	});

	return signed.url;
}

function encodeR2Key(key: string): string {
	return key.split("/").map(encodeURIComponent).join("/");
}
