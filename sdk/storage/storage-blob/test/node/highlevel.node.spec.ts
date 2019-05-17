import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { PassThrough } from "stream";

import { BlobClient, BlockBlobClient, ContainerClient } from "../../src";
import { Aborter } from "../../src/Aborter";
import {
  downloadBlobToBuffer,
  uploadFileToBlockBlob,
  uploadStreamToBlockBlob
} from "../../src/highlevel.node";
import { IRetriableReadableStreamOptions } from "../../src/utils/RetriableReadableStream";
import { createRandomLocalFile, getBSU, getUniqueName, readStreamToLocalFile } from "../utils";

// tslint:disable:no-empty
describe("Highlevel", () => {
  const blobServiceClient = getBSU();
  let containerName = getUniqueName("container");
  let containerClient = ContainerClient.fromBlobServiceClient(blobServiceClient, containerName);
  let blobName = getUniqueName("blob");
  let blobClient = BlobClient.fromContainerClient(containerClient, blobName);
  let blockBlobClient = BlockBlobClient.fromBlobClient(blobClient);
  let tempFileSmall: string;
  let tempFileSmallLength: number;
  let tempFileLarge: string;
  let tempFileLargeLength: number;
  const tempFolderPath = "temp";

  beforeEach(async () => {
    containerName = getUniqueName("container");
    containerClient = ContainerClient.fromBlobServiceClient(blobServiceClient, containerName);
    await containerClient.create();
    blobName = getUniqueName("blob");
    blobClient = BlobClient.fromContainerClient(containerClient, blobName);
    blockBlobClient = BlockBlobClient.fromBlobClient(blobClient);
  });

  afterEach(async () => {
    await containerClient.delete();
  });

  before(async () => {
    if (!fs.existsSync(tempFolderPath)) {
      fs.mkdirSync(tempFolderPath);
    }
    tempFileLarge = await createRandomLocalFile(tempFolderPath, 257, 1024 * 1024);
    tempFileLargeLength = 257 * 1024 * 1024;
    tempFileSmall = await createRandomLocalFile(tempFolderPath, 15, 1024 * 1024);
    tempFileSmallLength = 15 * 1024 * 1024;
  });

  after(async () => {
    fs.unlinkSync(tempFileLarge);
    fs.unlinkSync(tempFileSmall);
  });

  it("uploadFileToBlockBlob should success when blob >= BLOCK_BLOB_MAX_UPLOAD_BLOB_BYTES", async () => {
    await uploadFileToBlockBlob(tempFileLarge, blockBlobClient, {
      blockSize: 4 * 1024 * 1024,
      parallelism: 20
    });

    const downloadResponse = await blockBlobClient.download(0);
    const downloadedFile = path.join(tempFolderPath, getUniqueName("downloadfile."));
    await readStreamToLocalFile(downloadResponse.readableStreamBody!, downloadedFile);

    const downloadedData = await fs.readFileSync(downloadedFile);
    const uploadedData = await fs.readFileSync(tempFileLarge);

    fs.unlinkSync(downloadedFile);
    assert.ok(downloadedData.equals(uploadedData));
  });

  it("uploadFileToBlockBlob should success when blob < BLOCK_BLOB_MAX_UPLOAD_BLOB_BYTES", async () => {
    await uploadFileToBlockBlob(tempFileSmall, blockBlobClient, {
      blockSize: 4 * 1024 * 1024,
      parallelism: 20
    });

    const downloadResponse = await blockBlobClient.download(0);
    const downloadedFile = path.join(tempFolderPath, getUniqueName("downloadfile."));
    await readStreamToLocalFile(downloadResponse.readableStreamBody!, downloadedFile);

    const downloadedData = await fs.readFileSync(downloadedFile);
    const uploadedData = await fs.readFileSync(tempFileSmall);

    fs.unlinkSync(downloadedFile);
    assert.ok(downloadedData.equals(uploadedData));
  });

  it("uploadFileToBlockBlob should success when blob < BLOCK_BLOB_MAX_UPLOAD_BLOB_BYTES and configured maxSingleShotSize", async () => {
    await uploadFileToBlockBlob(tempFileSmall, blockBlobClient, {
      maxSingleShotSize: 0
    });

    const downloadResponse = await blockBlobClient.download(0);
    const downloadedFile = path.join(tempFolderPath, getUniqueName("downloadfile."));
    await readStreamToLocalFile(downloadResponse.readableStreamBody!, downloadedFile);

    const downloadedData = await fs.readFileSync(downloadedFile);
    const uploadedData = await fs.readFileSync(tempFileSmall);

    fs.unlinkSync(downloadedFile);
    assert.ok(downloadedData.equals(uploadedData));
  });

  it("uploadFileToBlockBlob should abort when blob >= BLOCK_BLOB_MAX_UPLOAD_BLOB_BYTES", async () => {
    const aborter = Aborter.timeout(1);

    try {
      await uploadFileToBlockBlob(tempFileLarge, blockBlobClient, {
        abortSignal: aborter,
        blockSize: 4 * 1024 * 1024,
        parallelism: 20
      });
      assert.fail();
    } catch (err) {
      assert.ok((err.code as string).toLowerCase().includes("abort"));
    }
  });

  it("uploadFileToBlockBlob should abort when blob < BLOCK_BLOB_MAX_UPLOAD_BLOB_BYTES", async () => {
    const aborter = Aborter.timeout(1);

    try {
      await uploadFileToBlockBlob(tempFileSmall, blockBlobClient, {
        abortSignal: aborter,
        blockSize: 4 * 1024 * 1024,
        parallelism: 20
      });
      assert.fail();
    } catch (err) {
      assert.ok((err.code as string).toLowerCase().includes("abort"));
    }
  });

  it("uploadFileToBlockBlob should update progress when blob >= BLOCK_BLOB_MAX_UPLOAD_BLOB_BYTES", async () => {
    let eventTriggered = false;
    const aborter = Aborter.none;

    try {
      await uploadFileToBlockBlob(tempFileLarge, blockBlobClient, {
        abortSignal: aborter,
        blockSize: 4 * 1024 * 1024,
        parallelism: 20,
        progress: (ev) => {
          assert.ok(ev.loadedBytes);
          eventTriggered = true;
          aborter.abort();
        }
      });
    } catch (err) {}
    assert.ok(eventTriggered);
  });

  it("uploadFileToBlockBlob should update progress when blob < BLOCK_BLOB_MAX_UPLOAD_BLOB_BYTES", async () => {
    let eventTriggered = false;
    const aborter = Aborter.none;

    try {
      await uploadFileToBlockBlob(tempFileSmall, blockBlobClient, {
        abortSignal: aborter,
        blockSize: 4 * 1024 * 1024,
        parallelism: 20,
        progress: (ev) => {
          assert.ok(ev.loadedBytes);
          eventTriggered = true;
          aborter.abort();
        }
      });
    } catch (err) {}
    assert.ok(eventTriggered);
  });

  it("uploadStreamToBlockBlob should success", async () => {
    const rs = fs.createReadStream(tempFileLarge);
    await uploadStreamToBlockBlob(rs, blockBlobClient, 4 * 1024 * 1024, 20);

    const downloadResponse = await blockBlobClient.download(0);

    const downloadFilePath = path.join(tempFolderPath, getUniqueName("downloadFile"));
    await readStreamToLocalFile(downloadResponse.readableStreamBody!, downloadFilePath);

    const downloadedBuffer = fs.readFileSync(downloadFilePath);
    const uploadedBuffer = fs.readFileSync(tempFileLarge);
    assert.ok(uploadedBuffer.equals(downloadedBuffer));

    fs.unlinkSync(downloadFilePath);
  });

  it("uploadStreamToBlockBlob should success for tiny buffers", async () => {
    const buf = Buffer.from([0x62, 0x75, 0x66, 0x66, 0x65, 0x72]);
    const bufferStream = new PassThrough();
    bufferStream.end(buf);

    await uploadStreamToBlockBlob(bufferStream, blockBlobClient, 4 * 1024 * 1024, 20);

    const downloadResponse = await blockBlobClient.download(0);

    const downloadFilePath = path.join(tempFolderPath, getUniqueName("downloadFile"));
    await readStreamToLocalFile(downloadResponse.readableStreamBody!, downloadFilePath);

    const downloadedBuffer = fs.readFileSync(downloadFilePath);
    assert.ok(buf.equals(downloadedBuffer));

    fs.unlinkSync(downloadFilePath);
  });

  it("uploadStreamToBlockBlob should abort", async () => {
    const rs = fs.createReadStream(tempFileLarge);
    const aborter = Aborter.timeout(1);

    try {
      await uploadStreamToBlockBlob(
        rs,
        blockBlobClient,
        4 * 1024 * 1024,
        20,
        {
          abortSignal: aborter
        }
      );
      assert.fail();
    } catch (err) {
      assert.ok((err.code as string).toLowerCase().includes("abort"));
    }
  });

  it("uploadStreamToBlockBlob should update progress event", async () => {
    const rs = fs.createReadStream(tempFileLarge);
    let eventTriggered = false;

    await uploadStreamToBlockBlob(rs, blockBlobClient, 4 * 1024 * 1024, 20, {
      progress: (ev) => {
        assert.ok(ev.loadedBytes);
        eventTriggered = true;
      }
    });
    assert.ok(eventTriggered);
  });

  it("downloadBlobToBuffer should success", async () => {
    const rs = fs.createReadStream(tempFileLarge);
    await uploadStreamToBlockBlob(rs, blockBlobClient, 4 * 1024 * 1024, 20);

    const buf = Buffer.alloc(tempFileLargeLength);
    await downloadBlobToBuffer(buf, blockBlobClient, 0, undefined, {
      blockSize: 4 * 1024 * 1024,
      maxRetryRequestsPerBlock: 5,
      parallelism: 20
    });

    const localFileContent = fs.readFileSync(tempFileLarge);
    assert.ok(localFileContent.equals(buf));
  });

  it("downloadBlobToBuffer should abort", async () => {
    const rs = fs.createReadStream(tempFileLarge);
    await uploadStreamToBlockBlob(rs, blockBlobClient, 4 * 1024 * 1024, 20);

    try {
      const buf = Buffer.alloc(tempFileLargeLength);
      await downloadBlobToBuffer(
        buf,
        blockBlobClient,
        0,
        undefined,
        {
          abortSignal: Aborter.timeout(1),
          blockSize: 4 * 1024 * 1024,
          maxRetryRequestsPerBlock: 5,
          parallelism: 20
        }
      );
      assert.fail();
    } catch (err) {
      assert.ok((err.code as string).toLowerCase().includes("abort"));
    }
  });

  it("downloadBlobToBuffer should update progress event", async () => {
    const rs = fs.createReadStream(tempFileSmall);
    await uploadStreamToBlockBlob(rs, blockBlobClient, 4 * 1024 * 1024, 10);

    let eventTriggered = false;
    const buf = Buffer.alloc(tempFileSmallLength);
    const aborter = Aborter.none;
    try {
      await downloadBlobToBuffer(buf, blockBlobClient, 0, undefined, {
        abortSignal: aborter,
        blockSize: 1 * 1024,
        maxRetryRequestsPerBlock: 5,
        parallelism: 1,
        progress: () => {
          eventTriggered = true;
          aborter.abort();
        }
      });
    } catch (err) {}
    assert.ok(eventTriggered);
  });

  it("blobclient.download should success when internal stream unexcepted ends at the stream end", async () => {
    const uploadResponse = await uploadFileToBlockBlob(
      tempFileSmall,
      blockBlobClient,
      {
        blockSize: 4 * 1024 * 1024,
        parallelism: 20
      }
    );

    let retirableReadableStreamOptions: IRetriableReadableStreamOptions;
    const downloadResponse = await blockBlobClient.download(
      0,
      undefined,
      {
        blobAccessConditions: {
          modifiedAccessConditions: {
            ifMatch: uploadResponse.eTag
          }
        },
        maxRetryRequests: 1,
        progress: ev => {
          if (ev.loadedBytes >= tempFileSmallLength) {
            retirableReadableStreamOptions.doInjectErrorOnce = true;
          }
        }
    });

    retirableReadableStreamOptions = (downloadResponse.readableStreamBody! as any).options;

    const downloadedFile = path.join(tempFolderPath, getUniqueName("downloadfile."));
    await readStreamToLocalFile(downloadResponse.readableStreamBody!, downloadedFile);

    const downloadedData = await fs.readFileSync(downloadedFile);
    const uploadedData = await fs.readFileSync(tempFileSmall);

    fs.unlinkSync(downloadedFile);
    assert.ok(downloadedData.equals(uploadedData));
  });

  it("blobclient.download should download full data successfully when internal stream unexcepted ends", async () => {
    const uploadResponse = await uploadFileToBlockBlob(
      tempFileSmall,
      blockBlobClient,
      {
        blockSize: 4 * 1024 * 1024,
        parallelism: 20
      }
    );

    let retirableReadableStreamOptions: IRetriableReadableStreamOptions;
    let injectedErrors = 0;
    const downloadResponse = await blockBlobClient.download(
      0,
      undefined,
      {
        blobAccessConditions: {
          modifiedAccessConditions: {
            ifMatch: uploadResponse.eTag
          }
        },
        maxRetryRequests: 3,
        progress: () => {
          if (injectedErrors++ < 3) {
            retirableReadableStreamOptions.doInjectErrorOnce = true;
          }
        }
    });

    retirableReadableStreamOptions = (downloadResponse.readableStreamBody! as any).options;

    const downloadedFile = path.join(tempFolderPath, getUniqueName("downloadfile."));
    await readStreamToLocalFile(downloadResponse.readableStreamBody!, downloadedFile);

    const downloadedData = await fs.readFileSync(downloadedFile);
    const uploadedData = await fs.readFileSync(tempFileSmall);

    fs.unlinkSync(downloadedFile);
    assert.ok(downloadedData.equals(uploadedData));
  });

  it("blobclient.download should download partial data when internal stream unexcepted ends", async () => {
    const uploadResponse = await uploadFileToBlockBlob(
      tempFileSmall,
      blockBlobClient,
      {
        blockSize: 4 * 1024 * 1024,
        parallelism: 20
      }
    );

    const partialSize = 500 * 1024;

    let retirableReadableStreamOptions: IRetriableReadableStreamOptions;
    let injectedErrors = 0;
    const downloadResponse = await blockBlobClient.download(
      0,
      partialSize,
      {
        blobAccessConditions: {
          modifiedAccessConditions: {
            ifMatch: uploadResponse.eTag
          }
        },
        maxRetryRequests: 3,
        progress: () => {
          if (injectedErrors++ < 3) {
            retirableReadableStreamOptions.doInjectErrorOnce = true;
          }
        }
    });

    retirableReadableStreamOptions = (downloadResponse.readableStreamBody! as any).options;

    const downloadedFile = path.join(tempFolderPath, getUniqueName("downloadfile."));
    await readStreamToLocalFile(downloadResponse.readableStreamBody!, downloadedFile);

    const downloadedData = await fs.readFileSync(downloadedFile);
    const uploadedData = await fs.readFileSync(tempFileSmall);

    fs.unlinkSync(downloadedFile);
    assert.ok(downloadedData.slice(0, partialSize).equals(uploadedData.slice(0, partialSize)));
  });

  it("blobclient.download should download data failed when exceeding max stream retry requests", async () => {
    const uploadResponse = await uploadFileToBlockBlob(
      tempFileSmall,
      blockBlobClient,
      {
        blockSize: 4 * 1024 * 1024,
        parallelism: 20
      }
    );

    const downloadedFile = path.join(tempFolderPath, getUniqueName("downloadfile."));

    let retirableReadableStreamOptions: IRetriableReadableStreamOptions;
    let injectedErrors = 0;
    let expectedError = false;

    try {
      const downloadResponse = await blockBlobClient.download(0, undefined, {
        blobAccessConditions: {
          modifiedAccessConditions: {
            ifMatch: uploadResponse.eTag
          }
        },
        maxRetryRequests: 0,
        progress: () => {
          if (injectedErrors++ < 1) {
            retirableReadableStreamOptions.doInjectErrorOnce = true;
          }
        }
      });
      retirableReadableStreamOptions = (downloadResponse.readableStreamBody! as any).options;
      await readStreamToLocalFile(downloadResponse.readableStreamBody!, downloadedFile);
    } catch (error) {
      expectedError = true;
    }

    assert.ok(expectedError);
    fs.unlinkSync(downloadedFile);
  });

  it("blobclient.download should abort after retrys", async () => {
    const uploadResponse = await uploadFileToBlockBlob(
      tempFileSmall,
      blockBlobClient,
      {
        blockSize: 4 * 1024 * 1024,
        parallelism: 20
      }
    );

    const downloadedFile = path.join(tempFolderPath, getUniqueName("downloadfile."));

    let retirableReadableStreamOptions: IRetriableReadableStreamOptions;
    let injectedErrors = 0;
    let expectedError = false;

    try {
      const aborter = Aborter.none;
      const downloadResponse = await blockBlobClient.download(
        0,
        undefined,
        {
          abortSignal: aborter,
          blobAccessConditions: {
            modifiedAccessConditions: {
              ifMatch: uploadResponse.eTag
            }
          },
          maxRetryRequests: 3,
          progress: () => {
            if (injectedErrors++ < 2) {
              // Triger 2 times of retry
              retirableReadableStreamOptions.doInjectErrorOnce = true;
            } else {
              // Trigger aborter
              aborter.abort();
            }
          }
      });
      retirableReadableStreamOptions = (downloadResponse.readableStreamBody! as any).options;
      await readStreamToLocalFile(downloadResponse.readableStreamBody!, downloadedFile);
    } catch (error) {
      expectedError = true;
    }

    assert.ok(expectedError);
    fs.unlinkSync(downloadedFile);
  });
});