import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import sharp from "sharp";

const source = new URL("../../src/assets/native-activities/video-worksheet-navigation.svg", import.meta.url);
const destination = new URL("../../src/assets/native-activities/video-worksheet-navigation.png", import.meta.url);
const bytes = await sharp(await readFile(source)).png().toBuffer();
if (process.argv.includes("--check")) assert.deepEqual(await readFile(destination), bytes, "Regenerate the canonical Video Worksheet artwork.");
else await writeFile(destination, bytes);
