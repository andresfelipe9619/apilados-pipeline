# Production Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the Apilados Pipeline to production environments. The system is designed for high availability, scalability, and operational excellence.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Infrastructure Setup](#infrastructure-setup)
3. [Environment Configuration](#environment-configuration)
4. [Deployment Process](#deployment-process)
5. [Post-Deployment Validation](#post-deployment-validation)
6. [Monitoring Setup](#monitoring-setup)
7. [Security Configuration](#security-configuration)
8. [Performance Optimization](#performance-optimization)

## Prerequisites

### Required Tools and Accounts

#### AWS Account Setup
- AWS Account with appropriate permissions
- AWS CLI configured with production credentials
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- Node.js 18+ installed
- TypeScript compiler installed

#### Access Requirements
- **Strapi Production Instance**: URL and authentication token
- **S3 Bucket Access**: Read/write permissions for data processing
- **CloudWatch Access**: Metrics and logging permissions
- **SNS Access**: For alerting and notifications
- **IAM Permissions**: Lambda execution and resource management

#### Development Environment
```bash
# Verify prerequisites
node --version  # Should be 18+
aws --version   # AWS CLI v2
cdk --version   # AWS CDK v2
npm --version   # npm 8+
```

### Infrastructure Requirements

#### AWS Services Used
- **AWS Lambda**: Data processing engine
- **Amazon S3**: File storage and event triggers
- **Amazon CloudWatch**: Monitoring and logging
- **Amazon SNS**: Alerting and notifications
- **AWS IAM**: Security and access management
- **AWS EventBridge**: Scheduled operations (optional)

#### Resource Limits
- **Lambda Memory**: 1024MB (configurable)
- **Lambda Timeout**: 15 minutes maximum
- **S3 Storage**: Unlimited (pay-per-use)
- **CloudWatch Logs**: 30-day retention (configurable)

## Infrastructure Setup

### 1. Clone and Setup Repository

```bash
# Clone the repository
git clone <repository-url>
cd apilados-pipeline

# Install dependencies
npm install

# Build the project
npm run build
```

### 2. Configure AWS Environment

```bash
# Configure AWS CLI for production
aws configure --profile production
# Enter your production AWS credentials

# Set the profile for CDK
export AWS_PROFILE=production

# Bootstrap CDK (one-time setup per account/region)
cdk bootstrap
```

### 3. Environment-Specific Configuration

Create production configuration files:

```bash
# Create production environment file
cp lambda/ingest/.env.example lambda/ingest/.env.production
```

Edit `.env.production` with production values:

```bash
# Strapi Configuration
STRAPI_BASE_URL=https://api.production.com/api
STRAPI_TOKEN=your-production-strapi-token

# Processing Configuration
PROCESS_MODE=parallel
OMIT_GET=false
BATCH_SIZE=100
CHUNK_SIZE=150

# Health Monitoring
HEALTH_ALERT_SNS_TOPIC=arn:aws:sns:us-east-1:123456789012:pipeline-alerts
HEALTH_REPORTS_S3_BUCKET=production-health-reports
HEALTH_CLOUDWATCH_NAMESPACE=Apilados/Pipeline/Production

# CCTs Configuration
CCTS_S3_BUCKET=production-data-bucket
CCTS_S3_KEY=ccts_export.csv
CCTS_USE_PRELOADING=false
CCTS_MAX_MEMORY_MB=512
```

## Environment Configuration

### 1. CDK Configuration

Update `cdk.json` for production:

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/apilados-pipeline.ts",
  "watch": {
    "include": ["**"],
    "exclude": ["README.md", "cdk*.json", "**/*.d.ts", "**/*.js", "tsconfig.json", "package*.json", "yarn.lock", "node_modules", "test"]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": ["aws", "aws-cn"],
    "@aws-cdk/core:enableStackNameDuplicates": true,
    "aws-cdk:enableDiffNoFail": true,
    "@aws-cdk/core:stackRelativeExports": true,
    "@aws-cdk/aws-rds:lowercaseDbIdentifier": true,
    "@aws-cdk/aws-lambda:recognizeVersionProps": true,
    "@aws-cdk/aws-cloudfront:defaultSecurityPolicyTLSv1.2_2021": true,
    "@aws-cdk/aws-apigatewayv2:payloadFormatVersionV2": true,
    "@aws-cdk/core:enablePartitionLiterals": true,
    "@aws-cdk/core:enableStackNameDuplicates": true
  }
}
```

### 2. Stack Configuration

Update the main stack file (`lib/apilados-pipeline-stack.ts`) with production parameters:

```typescript
// Production configuration
const productionConfig = {
  environment: 'production',
  lambdaMemorySize: 1024,
  lambdaTimeout: Duration.minutes(15),
  logRetention: RetentionDays.ONE_MONTH,
  
  // S3 Configuration
  bucketName: 'apilados-production-data',
  keyPrefix: 'uploads/',
  
  // Monitoring Configuration
  enableCloudWatch: true,
  enableAlerting: true,
  snsTopicName: 'apilados-pipeline-alerts',
  
  // Health Monitoring
  healthReportsBucket: 'apilados-health-reports',
  metricsNamespace: 'Apilados/Pipeline/Production'
};
```

### 3. Security Configuration

#### IAM Roles and Policies

The CDK stack automatically creates necessary IAM roles with least-privilege permissions:

```typescript
// Lambda execution role permissions
const lambdaPolicy = new PolicyStatement({
  effect: Effect.ALLOW,
  actions: [
    // S3 permissions
    's3:GetObject',
    's3:PutObject',
    's3:DeleteObject',
    's3:ListBucket',
    
    // CloudWatch permissions
    'cloudwatch:PutMetricData',
    'logs:CreateLogGroup',
    'logs:CreateLogStream',
    'logs:PutLogEvents',
    
    // SNS permissions
    'sns:Publish'
  ],
  resources: [
    `arn:aws:s3:::${bucketName}/*`,
    `arn:aws:s3:::${bucketName}`,
    'arn:aws:logs:*:*:*',
    `arn:aws:sns:*:*:${snsTopicName}`
  ]
});
```

#### S3 Bucket Security

```typescript
// S3 bucket with security best practices
const bucket = new Bucket(this, 'DataBucket', {
  bucketName: productionConfig.bucketName,
  encryption: BucketEncryption.S3_MANAGED,
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  versioning: true,
  lifecycleRules: [{
    id: 'DeleteOldVersions',
    expiration: Duration.days(90),
    noncurrentVersionExpiration: Duration.days(30)
  }],
  serverAccessLogsPrefix: 'access-logs/'
});
```

## Deployment Process

### 1. Pre-Deployment Validation

```bash
# Validate CDK configuration
cdk synth

# Run security checks
npm audit

# Run tests
cd lambda/ingest
npm test

# Validate environment configuration
npm run health:check -- --environment production --no-api
```

### 2. Deploy Infrastructure

```bash
# Deploy to production (with confirmation)
cdk deploy --profile production

# Deploy with specific parameters
cdk deploy --profile production \
  --parameters EnvironmentName=production \
  --parameters EnableMonitoring=true \
  --parameters LambdaMemorySize=1024
```

### 3. Deploy Lambda Function

The lambda function is automatically deployed as part of the CDK stack. To update just the function:

```bash
# Build the lambda function
cd lambda/ingest
npm run build

# Deploy only lambda changes (faster)
cd ../..
cdk deploy --hotswap --profile production
```

### 4. Environment Variables Setup

Set production environment variables in the Lambda function:

```bash
# Using AWS CLI
aws lambda update-function-configuration \
  --function-name apilados-pipeline-ingest \
  --environment Variables='{
    "STRAPI_BASE_URL":"https://api.production.com/api",
    "STRAPI_TOKEN":"your-production-token",
    "PROCESS_MODE":"parallel",
    "BATCH_SIZE":"100",
    "HEALTH_ALERT_SNS_TOPIC":"arn:aws:sns:us-east-1:123456789012:pipeline-alerts"
  }' \
  --profile production
```

## Post-Deployment Validation

### 1. Infrastructure Validation

```bash
# Verify stack deployment
cdk list --profile production

# Check stack outputs
aws cloudformation describe-stacks \
  --stack-name ApiladosPipelineStack \
  --query 'Stacks[0].Outputs' \
  --profile production
```

### 2. Lambda Function Validation

```bash
# Test lambda function
aws lambda invoke \
  --function-name apilados-pipeline-ingest \
  --payload '{"test": true}' \
  --profile production \
  response.json

# Check function configuration
aws lambda get-function-configuration \
  --function-name apilados-pipeline-ingest \
  --profile production
```

### 3. S3 Integration Testing

```bash
# Upload test file to trigger processing
aws s3 cp test-file.csv \
  s3://apilados-production-data/uploads/ \
  --profile production

# Monitor CloudWatch logs
aws logs tail /aws/lambda/apilados-pipeline-ingest \
  --follow \
  --profile production
```

### 4. Health Check Validation

```bash
# Run health check against production
cd lambda/ingest
npm run health:check -- --environment production

# Generate health report
npm run health:report -- --environment production --output prod-health.json
```

## Monitoring Setup

### 1. CloudWatch Dashboard

```bash
# Create CloudWatch dashboard
aws cloudwatch put-dashboard \
  --dashboard-name "Apilados-Pipeline-Production" \
  --dashboard-body file://lambda/ingest/cloudwatch-dashboard.json \
  --profile production
```

### 2. CloudWatch Alarms

```bash
# Create error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "Apilados-Pipeline-High-Error-Rate" \
  --alarm-description "Alert when error rate exceeds 5%" \
  --metric-name "ErrorRate" \
  --namespace "Apilados/Pipeline/Production" \
  --statistic "Average" \
  --period 300 \
  --threshold 5 \
  --comparison-operator "GreaterThanThreshold" \
  --evaluation-periods 2 \
  --alarm-actions "arn:aws:sns:us-east-1:123456789012:pipeline-alerts" \
  --profile production

# Create memory usage alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "Apilados-Pipeline-High-Memory-Usage" \
  --alarm-description "Alert when memory usage exceeds 85%" \
  --metric-name "MemoryUsagePercentage" \
  --namespace "Apilados/Pipeline/Production" \
  --statistic "Average" \
  --period 300 \
  --threshold 85 \
  --comparison-operator "GreaterThanThreshold" \
  --evaluation-periods 1 \
  --alarm-actions "arn:aws:sns:us-east-1:123456789012:pipeline-alerts" \
  --profile production
```

### 3. SNS Topic Setup

```bash
# Create SNS topic for alerts
aws sns create-topic \
  --name apilados-pipeline-alerts \
  --profile production

# Subscribe email to alerts
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:pipeline-alerts \
  --protocol email \
  --notification-endpoint admin@company.com \
  --profile production
```

### 4. Log Aggregation

```bash
# Set log retention
aws logs put-retention-policy \
  --log-group-name /aws/lambda/apilados-pipeline-ingest \
  --retention-in-days 30 \
  --profile production

# Create log insights queries
aws logs put-query-definition \
  --name "Apilados-Pipeline-Errors" \
  --query-string 'fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc' \
  --log-group-names /aws/lambda/apilados-pipeline-ingest \
  --profile production
```

## Security Configuration

### 1. Network Security

```bash
# Configure VPC (if required)
# The lambda can run in a VPC for additional security
# Update CDK stack to include VPC configuration
```

### 2. Encryption

```bash
# Enable S3 bucket encryption (already configured in CDK)
aws s3api put-bucket-encryption \
  --bucket apilados-production-data \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }' \
  --profile production

# Enable CloudWatch Logs encryption
aws logs associate-kms-key \
  --log-group-name /aws/lambda/apilados-pipeline-ingest \
  --kms-key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012 \
  --profile production
```

### 3. Access Control

```bash
# Review IAM policies
aws iam get-role-policy \
  --role-name apilados-pipeline-lambda-role \
  --policy-name apilados-pipeline-lambda-policy \
  --profile production

# Enable CloudTrail for audit logging
aws cloudtrail create-trail \
  --name apilados-pipeline-audit \
  --s3-bucket-name apilados-audit-logs \
  --include-global-service-events \
  --is-multi-region-trail \
  --profile production
```

## Performance Optimization

### 1. Lambda Configuration

```bash
# Optimize lambda memory based on profiling
aws lambda update-function-configuration \
  --function-name apilados-pipeline-ingest \
  --memory-size 1024 \
  --timeout 900 \
  --profile production

# Enable provisioned concurrency for consistent performance
aws lambda put-provisioned-concurrency-config \
  --function-name apilados-pipeline-ingest \
  --provisioned-concurrency-config ProvisionedConcurrencyCount=2 \
  --profile production
```

### 2. S3 Optimization

```bash
# Configure S3 transfer acceleration
aws s3api put-bucket-accelerate-configuration \
  --bucket apilados-production-data \
  --accelerate-configuration Status=Enabled \
  --profile production

# Set up intelligent tiering
aws s3api put-bucket-intelligent-tiering-configuration \
  --bucket apilados-production-data \
  --id EntireBucket \
  --intelligent-tiering-configuration '{
    "Id": "EntireBucket",
    "Status": "Enabled",
    "Filter": {"Prefix": ""},
    "Tierings": [{
      "Days": 1,
      "AccessTier": "ARCHIVE_ACCESS"
    }]
  }' \
  --profile production
```

### 3. Monitoring Performance

```bash
# Create performance dashboard
aws cloudwatch put-dashboard \
  --dashboard-name "Apilados-Pipeline-Performance" \
  --dashboard-body '{
    "widgets": [{
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Duration", "FunctionName", "apilados-pipeline-ingest"],
          ["AWS/Lambda", "Errors", "FunctionName", "apilados-pipeline-ingest"],
          ["AWS/Lambda", "Throttles", "FunctionName", "apilados-pipeline-ingest"]
        ],
        "period": 300,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Lambda Performance"
      }
    }]
  }' \
  --profile production
```

## Deployment Checklist

### Pre-Deployment
- [ ] Environment variables configured
- [ ] CDK configuration updated for production
- [ ] Security policies reviewed
- [ ] Tests passing
- [ ] Health checks validated

### Deployment
- [ ] CDK stack deployed successfully
- [ ] Lambda function deployed and configured
- [ ] S3 bucket created and configured
- [ ] IAM roles and policies applied
- [ ] Environment variables set

### Post-Deployment
- [ ] Infrastructure validation completed
- [ ] Lambda function tested
- [ ] S3 integration verified
- [ ] Health checks passing
- [ ] Monitoring dashboard created
- [ ] Alerts configured
- [ ] SNS notifications tested
- [ ] Performance metrics baseline established

### Ongoing Maintenance
- [ ] Regular health check monitoring
- [ ] Performance metrics review
- [ ] Security audit schedule
- [ ] Backup and recovery procedures tested
- [ ] Documentation updated

## Rollback Procedures

### Emergency Rollback

```bash
# Rollback to previous CDK deployment
cdk deploy --rollback --profile production

# Rollback lambda function to previous version
aws lambda update-function-code \
  --function-name apilados-pipeline-ingest \
  --s3-bucket deployment-artifacts \
  --s3-key previous-version.zip \
  --profile production
```

### Gradual Rollback

```bash
# Update lambda alias to previous version
aws lambda update-alias \
  --function-name apilados-pipeline-ingest \
  --name LIVE \
  --function-version 1 \
  --profile production

# Monitor for issues and complete rollback if needed
```

## Support and Maintenance

### Regular Maintenance Tasks

1. **Weekly**: Review CloudWatch metrics and alerts
2. **Monthly**: Update dependencies and security patches
3. **Quarterly**: Performance optimization review
4. **Annually**: Security audit and compliance review

### Support Contacts

- **Development Team**: dev-team@company.com
- **Operations Team**: ops-team@company.com
- **Security Team**: security-team@company.com

### Emergency Procedures

1. **Critical Issues**: Contact on-call engineer immediately
2. **Performance Issues**: Review CloudWatch metrics and scale resources
3. **Security Issues**: Follow incident response procedures
4. **Data Issues**: Activate backup and recovery procedures

This production deployment guide ensures a secure, scalable, and maintainable deployment of the Apilados Pipeline system.