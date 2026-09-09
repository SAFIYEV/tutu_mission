import { afterEach, describe, expect, it } from "vitest";
import { isBedrockConfigured } from "./bedrock";

const originalMetadataEndpoint = process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT;

afterEach(() => {
  if (originalMetadataEndpoint === undefined) delete process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT;
  else process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT = originalMetadataEndpoint;
});

describe("Bedrock credential detection", () => {
  it("recognizes an explicit EC2 instance-profile metadata endpoint", () => {
    process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT = "http://169.254.169.254";
    expect(isBedrockConfigured()).toBe(true);
  });
});
