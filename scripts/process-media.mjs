import { execFileSync } from "node:child_process";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";

const root = process.cwd();
const source = path.join(root, ".asset-source", "review");
const media = path.join(root, "public", "media");
await mkdir(media, { recursive: true });

const selected = [
  ["stay-own-tent-day.webp", "source-073.jpg", 1200, 1500],
  ["stay-own-tent-night.webp", "source-081.jpg", 1200, 1500],
  ["stay-rental-day.webp", "source-057.jpg", 1200, 1500],
  ["stay-rental-night.webp", "source-003.jpg", 1200, 1500],
  ["stay-glamping-day.webp", "source-089.jpg", 1200, 1500],
  ["stay-glamping-night.webp", "source-049.jpg", 1200, 1500],
  ["stay-family-day.webp", "source-030.jpg", 1200, 1500],
  ["stay-family-night.webp", "source-071.jpg", 1200, 1500],
  ["activity-kayak.webp", "source-079.jpg", 960, 720],
  ["activity-sup.webp", "source-026.jpg", 960, 720],
  ["activity-quad.webp", "source-068.jpg", 960, 720],
  ["activity-bath.webp", "source-049.jpg", 960, 720],
  ["activity-farm.webp", "source-044.jpg", 960, 720],
  ["activity-campfire.webp", "source-025.jpg", 960, 720],
  ["territory-main.webp", "source-074.jpg", 1440, 1100],
  ["final-day.webp", "source-061.jpg", 1600, 900],
  ["final-night.webp", "source-049.jpg", 1600, 900],
];

for (const [output, input, width, height] of selected) {
  await sharp(path.join(source, input))
    .rotate()
    .resize(width, height, { fit: "cover", position: "attention", withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toFile(path.join(media, output));
}

const gallery = [
  ["01", "source-073.jpg", 1440, 960],
  ["02", "source-074.jpg", 1440, 960],
  ["03", "source-079.jpg", 960, 1440],
  ["04", "source-068.jpg", 1440, 960],
  ["05", "source-025.jpg", 960, 1440],
  ["06", "source-089.jpg", 1440, 960],
  ["07", "source-030.jpg", 960, 1440],
  ["08", "source-067.jpg", 1440, 960],
];

for (const [number, input, width, height] of gallery) {
  const pipeline = sharp(path.join(source, input)).rotate().resize(width, height, { fit: "cover", position: "attention", withoutEnlargement: true });
  await pipeline.clone().webp({ quality: number === "01" ? 55 : 72, effort: 6 }).toFile(path.join(media, `gallery-${number}.webp`));
  for (const variantWidth of [640, 960]) {
    await sharp(path.join(source, input))
      .rotate()
      .resize({ width: Math.min(variantWidth, width), withoutEnlargement: true })
      .webp({ quality: 68, effort: 5 })
      .toFile(path.join(media, `gallery-${number}-${variantWidth}.webp`));
  }
}

if (!ffmpegPath) throw new Error("ffmpeg-static binary is unavailable");
for (const variant of ["day", "night"]) {
  const frame = path.join(root, ".asset-source", `hero-${variant}.jpg`);
  execFileSync(ffmpegPath, ["-y", "-ss", "2", "-i", path.join(root, `${variant}.mp4`), "-frames:v", "1", "-q:v", "2", frame], { stdio: "ignore" });
  await sharp(frame)
    .rotate()
    .resize(1600, 1000, { fit: "cover", position: "centre", withoutEnlargement: true })
    .webp({ quality: 82, effort: 6 })
    .toFile(path.join(media, `hero-${variant}.webp`));
}

const logo = path.join(root, "public", "logo-kemping-drive.png");
const logoTemp = path.join(root, "public", "logo-kemping-drive.optimized.png");
await sharp(logo).rotate().resize({ width: 720, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(logoTemp);
await rename(logoTemp, logo);

const files = await Promise.all(
  [...selected.map(([name]) => name), ...gallery.map(([number]) => `gallery-${number}.webp`), "hero-day.webp", "hero-night.webp"].map(async (name) => ({ name, size: (await stat(path.join(media, name))).size })),
);
console.log(files.map(({ name, size }) => `${name}: ${Math.round(size / 1024)} KB`).join("\n"));
