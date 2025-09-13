/**
 * Tests for file input handlers
 */

import { S3Event } from "aws-lambda";
import { 
  S3FileInputHandler, 
  LocalFileInputHandler, 
  FileInputHandlerFactory,
  createFileInputHandler,
  validateFileInputConfig
} from "./file-input-handlers";
import { LocalConfig } from "./types";

// Mock S3 event for testing
const mockS3Event: S3Event = {
  Records: [
    {
      eventVersion: "2.1",
      eventSource: "aws:s3",
      awsRegion: "us-east-1",
      eventTime: "2023-01-01T00:00:00.000Z",
      eventName: "ObjectCreated:Put",
      userIdentity: {
        principalId: "test"
      },
      requestParameters: {
        sourceIPAddress: "127.0.0.1"
      },
      responseElements: {
        "x-amz-request-id": "test",
        "x-amz-id-2": "test"
      },
      s3: {
        s3SchemaVersion: "1.0",
        configurationId: "test",
        bucket: {
          name: "test-bucket",
          ownerIdentity: {
            principalId: "test"
          },
          arn: "arn:aws:s3:::test-bucket"
        },
        object: {
          key: "test-folder/participations.csv",
          size: 1024,
          eTag: "test",
          sequencer: "test"
        }
      }
    }
  ]
};

const mockLocalConfig: LocalConfig = {
  participationsCsvPath: "../../test-data/sample.csv",
  cctsCsvPath: "../../test-data/ccts.csv"
};

describe("FileInputHandlerFactory", () => {
  test("should create S3FileInputHandler for S3 event", () => {
    const handler = FileInputHandlerFactory.create(mockS3Event);
    expect(handler).toBeInstanceOf(S3FileInputHandler);
    expect(handler.getExecutionMode()).toBe("aws");
  });

  test("should create LocalFileInputHandler for local config", () => {
    const handler = FileInputHandlerFactory.create(undefined, mockLocalConfig);
    expect(handler).toBeInstanceOf(LocalFileInputHandler);
    expect(handler.getExecutionMode()).toBe("local");
  });

  test("should throw error when no config provided", () => {
    expect(() => {
      FileInputHandlerFactory.create();
    }).toThrow("Unable to determine execution mode");
  });

  test("should detect AWS execution mode", () => {
    const mode = FileInputHandlerFactory.detectExecutionMode(mockS3Event);
    expect(mode).toBe("aws");
  });

  test("should detect local execution mode", () => {
    const mode = FileInputHandlerFactory.detectExecutionMode(undefined, mockLocalConfig);
    expect(mode).toBe("local");
  });
});

describe("createFileInputHandler", () => {
  test("should create handler successfully", () => {
    const handler = createFileInputHandler(mockS3Event);
    expect(handler).toBeInstanceOf(S3FileInputHandler);
  });

  test("should provide helpful error messages", () => {
    expect(() => {
      createFileInputHandler();
    }).toThrow("No execution context provided");
  });
});

describe("validateFileInputConfig", () => {
  test("should validate S3 event successfully", () => {
    const result = validateFileInputConfig(mockS3Event);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("should validate local config successfully", () => {
    const result = validateFileInputConfig(undefined, mockLocalConfig);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("should return errors for invalid config", () => {
    const result = validateFileInputConfig();
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("No execution context provided (neither S3 event nor local config)");
  });

  test("should return warnings for missing files", () => {
    const configWithMissingFile: LocalConfig = {
      participationsCsvPath: "./non-existent-file.csv"
    };
    const result = validateFileInputConfig(undefined, configWithMissingFile);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});