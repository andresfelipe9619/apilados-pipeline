import {
  Stack, StackProps, Duration, RemovalPolicy,
  aws_s3 as s3,
  aws_sqs as sqs,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNode,
  aws_lambda_event_sources as eventSources,
  aws_iam as iam,
  aws_events as events,
  aws_events_targets as targets,
  aws_logs as logs,
  aws_ssm as ssm,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

type Params = {
  bucketPrefix: string;
  s3KeyPrefix: string;
  instanceIds: string[];
  startCron: string;
  stopCron: string;
  strapiBaseUrl: string;
  strapiTokenSsmParam: string;
};

export class ApiladosPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { params: Params }) {
    super(scope, id, props);
    const p = props.params;

    // --- S3 bucket for incoming CSVs
    const bucket = new s3.Bucket(this, 'ApiladosBucket', {
      bucketName: `${p.bucketPrefix}-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // --- DLQ for ingest Lambda
    const dlq = new sqs.Queue(this, 'IngestDlq', {
      retentionPeriod: Duration.days(14),
    });

    // --- Ingest Lambda (Node 20 + esbuild bundling)
    const ingestFn = new lambdaNode.NodejsFunction(this, 'IngestFn', {
      entry: 'lambda/ingest/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1536,
      timeout: Duration.minutes(15),
      architecture: lambda.Architecture.ARM_64,
      logRetention: logs.RetentionDays.ONE_MONTH,
      deadLetterQueue: dlq,
      environment: {
        BUCKET_NAME: bucket.bucketName,
        STRAPI_BASE_URL: p.strapiBaseUrl,
        STRAPI_TOKEN_PARAM: p.strapiTokenSsmParam,
        S3_KEY_PREFIX: p.s3KeyPrefix,
        CHUNK_SIZE: '150', // tune 100–200
      },
      bundling: {
        minify: true,
        externalModules: ['aws-sdk'], // provided in runtime
        sourceMap: true,
      },
      // reserve some concurrency to protect Strapi
      reservedConcurrentExecutions: 5,
    });

    // IAM for ingest: read S3, get token from SSM
    bucket.grantRead(ingestFn);
    ssm.StringParameter.fromStringParameterName(
      this, 'StrapiTokenParam', p.strapiTokenSsmParam,
    ).grantRead(ingestFn);

    // S3 → Lambda notification (prefix .csv)
    ingestFn.addEventSource(new eventSources.S3EventSource(bucket, {
      events: [s3.EventType.OBJECT_CREATED],
      filters: [{ prefix: p.s3KeyPrefix, suffix: '.csv' }],
    }));

    // --- Start EC2 Lambda
    const startFn = new lambdaNode.NodejsFunction(this, 'StartEc2Fn', {
      entry: 'lambda/start-ec2/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      architecture: lambda.Architecture.ARM_64,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: { INSTANCE_IDS: JSON.stringify(p.instanceIds) },
      bundling: { minify: true, sourceMap: true },
    });

    // --- Stop EC2 Lambda
    const stopFn = new lambdaNode.NodejsFunction(this, 'StopEc2Fn', {
      entry: 'lambda/stop-ec2/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      architecture: lambda.Architecture.ARM_64,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: { INSTANCE_IDS: JSON.stringify(p.instanceIds) },
      bundling: { minify: true, sourceMap: true },
    });

    // Least-privilege IAM on specific instance IDs
    const instanceArns = p.instanceIds.map(
      id => `arn:aws:ec2:${this.region}:${this.account}:instance/${id}`
    );
    [startFn, stopFn].forEach(fn => {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['ec2:StartInstances', 'ec2:StopInstances', 'ec2:DescribeInstances'],
        resources: instanceArns,
      }));
    });

    // --- EventBridge schedules
    new events.Rule(this, 'StartRule', {
      schedule: events.Schedule.expression(p.startCron),
      targets: [new targets.LambdaFunction(startFn)],
    });

    new events.Rule(this, 'StopRule', {
      schedule: events.Schedule.expression(p.stopCron),
      targets: [new targets.LambdaFunction(stopFn)],
    });
  }
}