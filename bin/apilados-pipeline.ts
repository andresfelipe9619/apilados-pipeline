#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ApiladosPipelineStack } from '../lib/apilados-pipeline-stack';

const app = new cdk.App();
new ApiladosPipelineStack(app, 'ApiladosPipelineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },

  // 👇 tweak these to your needs
  params: {
    bucketPrefix: 'apilados',           // bucket name prefix
    s3KeyPrefix: 'incoming/',           // only trigger on this prefix
    instanceIds: ['i-0123456789abcdef0'], // EC2s to start/stop
    startCron: 'cron(0 12 ? * MON-FRI *)', // 12:00 UTC Mon–Fri
    stopCron:  'cron(0 23 ? * MON-FRI *)', // 23:00 UTC Mon–Fri
    strapiBaseUrl: 'https://api.example.com',
    strapiTokenSsmParam: '/apilados/STRAPI_TOKEN', // store token in SSM
  },
});