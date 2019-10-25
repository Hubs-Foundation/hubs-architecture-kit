const program = require("commander");
const promptly = require("promptly");
const AWS = require("aws-sdk");
const glob = require("glob-promise");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const { version } = require("../package.json");

program
  .version(version)
  .arguments("<src> <bucket> <dest>")
  .parse(process.argv);

async function uploadFiles(s3Client, srcDir, bucket, destDir) {
  const files = await glob(path.join(srcDir, "**", "*"), {
    absolute: true,
    nodir: true
  });

  const rootDir = path.resolve(srcDir);

  const uploadTasks = files.map(filePath =>
    createUploadTask(s3Client, rootDir, filePath, bucket, destDir)
  );

  const uploadPromises = uploadTasks.map((req, idx) =>
    req
      .promise()
      .then(() => {
        console.log(`Successfully uploaded: ${files[idx]}`);
      })
      .catch(err => {
        console.error(`Error uploading: ${files[idx]}`);
        throw err;
      })
  );

  await Promise.all(uploadPromises);
}

function createUploadTask(s3Client, rootDir, filePath, bucket, destDir) {
  const extension = path.extname(filePath);

  const fileStream = createFileStream(filePath, extension);

  const key = destDir + path.relative(rootDir, filePath).replace(/\\/g, "/");

  const req = s3Client.upload({
    ACL: "public-read",
    Body: fileStream,
    Bucket: bucket,
    CacheControl: getCacheControl(filePath),
    ContentEncoding: shouldGzip(extension) ? "gzip" : undefined,
    ContentType: getContentType(filePath, extension),
    Key: key
  });

  return req;
}

const GZIPPED_EXTENSIONS = [".json", ".gltf", ".bin"];

function shouldGzip(extension) {
  return GZIPPED_EXTENSIONS.indexOf(extension) !== -1;
}

function createFileStream(filePath, extension) {
  const readStream = fs.createReadStream(filePath);

  if (shouldGzip(extension)) {
    const gzipStream = zlib.createGzip();
    return readStream.pipe(gzipStream);
  }

  return readStream;
}

function getContentType(filePath, extension) {
  switch (extension) {
    case ".json":
      return "application/json";
    case ".gltf":
      return "model/gltf+json";
    case ".bin":
      return "application/octet-stream";
    case ".png":
      return "image/png";
    case ".jpeg":
      return "image/jpeg";
    case ".jpg":
      return "image/jpeg";
    default:
      throw `Unsupported file type ${extension} for ${filePath}`;
  }
}

function getCacheControl(filePath) {
  if (filePath.endsWith(".json")) {
    return "no-cache, no-store, must-revalidate";
  }

  return "public, max-age=31536000";
}

(async function execute() {
  const normalizedPath = path.normalize(program.args[0]);
  const bucket = program.args[1];
  const destPath = program.args[2];
  

  if (
    await promptly.confirm(
      `Are you sure you wish to deploy to ${bucket}? (y/n)`
    )
  ) {
    const s3 = new AWS.S3({
      accessKeyId: AWS.config.credentials.accessKeyId,
      secretAccessKey: AWS.config.credentials.secretAccessKey
    });

    await uploadFiles(s3, normalizedPath, bucket, destPath);
    console.log("Done!");
    process.exit(0);
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});