interface S3Config {
  artifactsBucket: string;
  applicationBucket: string;
}

export const getS3Config = (): S3Config => {
  return {
    artifactsBucket: process.env.S3_ARTIFACTS_BUCKET!,
    applicationBucket: process.env.S3_APPLICATION_BUCKET!
  };
};
