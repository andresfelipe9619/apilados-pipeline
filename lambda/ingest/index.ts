import {S3Event, S3Handler} from 'aws-lambda';
import {S3Client, GetObjectCommand} from '@aws-sdk/client-s3';
import {Readable} from 'node:stream';
import {SSMClient, GetParameterCommand} from '@aws-sdk/client-ssm';

const s3 = new S3Client({});
const ssm = new SSMClient({});

const STRAPI_BASE_URL = process.env.STRAPI_BASE_URL!;
const TOKEN_PARAM = process.env.STRAPI_TOKEN_PARAM!;
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || '150');

const streamToString = async (stream: Readable) =>
    await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (c) => chunks.push(Buffer.from(c)));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });

export const handler: S3Handler = async (event: S3Event) => {
    const tokenParam = await ssm.send(new GetParameterCommand({Name: TOKEN_PARAM, WithDecryption: true}));
    const STRAPI_TOKEN = tokenParam.Parameter?.Value!;
    const headers = {'Content-Type': 'application/json', 'Authorization': `Bearer ${STRAPI_TOKEN}`};

    for (const r of event.Records) {
        const bucket = r.s3.bucket.name;
        const key = decodeURIComponent(r.s3.object.key);

        // fetch object
        const obj = await s3.send(new GetObjectCommand({Bucket: bucket, Key: key}));
        const csv = await streamToString(obj.Body as Readable);

        // parse CSV (simple split; replace with robust parser if needed)
        const [headerLine, ...lines] = csv.trim().split('\n');
        const headersCsv = headerLine.split(',').map(h => h.trim());

        // chunk & upsert
        for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
            const slice = lines.slice(i, i + CHUNK_SIZE).map(line => {
                const cols = line.split(',').map(v => v.trim());
                const rec: Record<string, string> = {};
                headersCsv.forEach((h, idx) => (rec[h] = cols[idx] ?? ''));
                return rec;
            });

            // Example: POST to Strapi collection `apilados`
            const res = await fetch(`${STRAPI_BASE_URL}/api/apilados/bulk-upsert`, {
                method: 'POST',
                headers, body: JSON.stringify({data: slice}),
            });

            if (!res.ok) {
                const body = await res.text();
                console.error('Strapi error', res.status, body);
                throw new Error(`Strapi failed: ${res.status}`);
            }
        }
        console.log(`Processed: s3://${bucket}/${key} (${lines.length} rows)`);
    }
};