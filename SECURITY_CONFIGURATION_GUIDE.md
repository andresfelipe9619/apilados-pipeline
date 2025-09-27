# Security Configuration Guide

## Overview

This guide provides comprehensive security configuration requirements and best practices for the Apilados Pipeline production deployment. It covers all aspects of security including access control, encryption, monitoring, and compliance.

## Table of Contents

1. [Security Architecture](#security-architecture)
2. [Identity and Access Management (IAM)](#identity-and-access-management-iam)
3. [Data Encryption](#data-encryption)
4. [Network Security](#network-security)
5. [Monitoring and Auditing](#monitoring-and-auditing)
6. [Secrets Management](#secrets-management)
7. [Compliance and Governance](#compliance-and-governance)
8. [Security Testing](#security-testing)

## Security Architecture

### Security Principles

The Apilados Pipeline follows these core security principles:

1. **Defense in Depth**: Multiple layers of security controls
2. **Least Privilege**: Minimal necessary permissions
3. **Zero Trust**: Verify everything, trust nothing
4. **Encryption Everywhere**: Data encrypted at rest and in transit
5. **Continuous Monitoring**: Real-time security monitoring
6. **Incident Response**: Rapid detection and response capabilities

### Security Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                        AWS Account                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    VPC (Optional)                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │   │
│  │  │   Lambda    │  │     S3      │  │ CloudWatch  │ │   │
│  │  │  Function   │  │   Bucket    │  │    Logs     │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  External: Strapi API (HTTPS only)                         │
└─────────────────────────────────────────────────────────────┘
```

## Identity and Access Management (IAM)

### Lambda Execution Role

#### Minimum Required Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3DataAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::apilados-production-data/*"
      ]
    },
    {
      "Sid": "S3BucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::apilados-production-data"
      ],
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "uploads/*",
            "health-reports/*"
          ]
        }
      }
    },
    {
      "Sid": "CloudWatchMetrics",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "cloudwatch:namespace": "Apilados/Pipeline/Production"
        }
      }
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": [
        "arn:aws:logs:*:*:log-group:/aws/lambda/apilados-pipeline-ingest*"
      ]
    },
    {
      "Sid": "SNSAlerts",
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": [
        "arn:aws:sns:*:*:apilados-pipeline-alerts"
      ]
    }
  ]
}
```

#### Implementation

```bash
# Create the IAM role
aws iam create-role \
  --role-name apilados-pipeline-lambda-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }]
  }' \
  --profile production

# Attach the custom policy
aws iam put-role-policy \
  --role-name apilados-pipeline-lambda-role \
  --policy-name ApiladosPipelinePolicy \
  --policy-document file://lambda-security-policy.json \
  --profile production
```

### Cross-Account Access (if applicable)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CrossAccountAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::TRUSTED-ACCOUNT-ID:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "unique-external-id"
        }
      }
    }
  ]
}
```

### Service-Linked Roles

```bash
# Create service-linked role for Lambda (if not exists)
aws iam create-service-linked-role \
  --aws-service-name lambda.amazonaws.com \
  --profile production
```

## Data Encryption

### Encryption at Rest

#### S3 Bucket Encryption

```bash
# Enable S3 bucket encryption with AES-256
aws s3api put-bucket-encryption \
  --bucket apilados-production-data \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      },
      "BucketKeyEnabled": true
    }]
  }' \
  --profile production

# Alternative: Use KMS encryption for enhanced security
aws s3api put-bucket-encryption \
  --bucket apilados-production-data \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
      },
      "BucketKeyEnabled": true
    }]
  }' \
  --profile production
```

#### Lambda Environment Variables Encryption

```bash
# Create KMS key for Lambda environment variables
aws kms create-key \
  --description "Apilados Pipeline Lambda Environment Variables" \
  --key-usage ENCRYPT_DECRYPT \
  --key-spec SYMMETRIC_DEFAULT \
  --profile production

# Enable encryption for Lambda environment variables
aws lambda update-function-configuration \
  --function-name apilados-pipeline-ingest \
  --kms-key-arn arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012 \
  --profile production
```

#### CloudWatch Logs Encryption

```bash
# Create KMS key for CloudWatch Logs
aws kms create-key \
  --description "Apilados Pipeline CloudWatch Logs" \
  --key-usage ENCRYPT_DECRYPT \
  --key-spec SYMMETRIC_DEFAULT \
  --profile production

# Associate KMS key with log group
aws logs associate-kms-key \
  --log-group-name /aws/lambda/apilados-pipeline-ingest \
  --kms-key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012 \
  --profile production
```

### Encryption in Transit

#### HTTPS/TLS Configuration

All external communications must use HTTPS/TLS:

```bash
# Verify Strapi API uses HTTPS
curl -I https://api.production.com/api/encuestas

# Expected response should include:
# HTTP/2 200
# strict-transport-security: max-age=31536000; includeSubDomains
```

#### Certificate Validation

```typescript
// Lambda function should validate SSL certificates
const axios = require('axios');

const api = axios.create({
  baseURL: process.env.STRAPI_BASE_URL,
  timeout: 30000,
  // Ensure SSL certificate validation
  httpsAgent: new https.Agent({
    rejectUnauthorized: true,
    checkServerIdentity: (host, cert) => {
      // Additional certificate validation if needed
      return undefined;
    }
  })
});
```

## Network Security

### VPC Configuration (Optional but Recommended)

```typescript
// CDK VPC configuration for enhanced security
const vpc = new Vpc(this, 'ApiladosVPC', {
  maxAzs: 2,
  natGateways: 1,
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: 'Private',
      subnetType: SubnetType.PRIVATE_WITH_EGRESS
    },
    {
      cidrMask: 24,
      name: 'Public',
      subnetType: SubnetType.PUBLIC
    }
  ]
});

// Lambda in private subnet
const lambdaFunction = new Function(this, 'IngestFunction', {
  // ... other configuration
  vpc: vpc,
  vpcSubnets: {
    subnetType: SubnetType.PRIVATE_WITH_EGRESS
  }
});
```

### Security Groups

```bash
# Create security group for Lambda (if using VPC)
aws ec2 create-security-group \
  --group-name apilados-lambda-sg \
  --description "Security group for Apilados Pipeline Lambda" \
  --vpc-id vpc-12345678 \
  --profile production

# Allow HTTPS outbound traffic
aws ec2 authorize-security-group-egress \
  --group-id sg-12345678 \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 \
  --profile production
```

### Network ACLs

```bash
# Create restrictive Network ACL
aws ec2 create-network-acl \
  --vpc-id vpc-12345678 \
  --profile production

# Allow HTTPS outbound
aws ec2 create-network-acl-entry \
  --network-acl-id acl-12345678 \
  --rule-number 100 \
  --protocol tcp \
  --port-range From=443,To=443 \
  --cidr-block 0.0.0.0/0 \
  --profile production
```

## Monitoring and Auditing

### CloudTrail Configuration

```bash
# Create CloudTrail for audit logging
aws cloudtrail create-trail \
  --name apilados-pipeline-audit \
  --s3-bucket-name apilados-audit-logs \
  --include-global-service-events \
  --is-multi-region-trail \
  --enable-log-file-validation \
  --profile production

# Start logging
aws cloudtrail start-logging \
  --name apilados-pipeline-audit \
  --profile production
```

### CloudWatch Security Monitoring

```bash
# Create metric filter for security events
aws logs put-metric-filter \
  --log-group-name /aws/lambda/apilados-pipeline-ingest \
  --filter-name SecurityEvents \
  --filter-pattern '[timestamp, request_id, level="ERROR", message="*Access Denied*"]' \
  --metric-transformations \
    metricName=SecurityErrors,metricNamespace=Apilados/Security,metricValue=1 \
  --profile production

# Create alarm for security events
aws cloudwatch put-metric-alarm \
  --alarm-name "Apilados-Security-Events" \
  --alarm-description "Alert on security-related errors" \
  --metric-name SecurityErrors \
  --namespace Apilados/Security \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:security-alerts \
  --profile production
```

### AWS Config Rules

```bash
# Enable AWS Config
aws configservice put-configuration-recorder \
  --configuration-recorder name=apilados-config-recorder,roleARN=arn:aws:iam::123456789012:role/config-role \
  --profile production

# Create compliance rules
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "s3-bucket-ssl-requests-only",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "S3_BUCKET_SSL_REQUESTS_ONLY"
    }
  }' \
  --profile production
```

## Secrets Management

### AWS Secrets Manager

```bash
# Store Strapi token in Secrets Manager
aws secretsmanager create-secret \
  --name apilados/strapi/token \
  --description "Strapi API authentication token" \
  --secret-string '{
    "token": "your-strapi-token",
    "url": "https://api.production.com/api"
  }' \
  --profile production

# Set up automatic rotation (if supported by Strapi)
aws secretsmanager update-secret \
  --secret-id apilados/strapi/token \
  --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789012:function:strapi-token-rotator \
  --rotation-rules AutomaticallyAfterDays=30 \
  --profile production
```

### Lambda Code for Secrets Retrieval

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

async function getStrapiCredentials() {
  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: "apilados/strapi/token"
      })
    );
    
    const secret = JSON.parse(response.SecretString!);
    return {
      token: secret.token,
      url: secret.url
    };
  } catch (error) {
    console.error("Failed to retrieve Strapi credentials:", error);
    throw error;
  }
}
```

### Parameter Store (Alternative)

```bash
# Store configuration in Parameter Store
aws ssm put-parameter \
  --name "/apilados/strapi/token" \
  --value "your-strapi-token" \
  --type "SecureString" \
  --description "Strapi API token" \
  --profile production

# Grant Lambda permission to access parameter
aws iam put-role-policy \
  --role-name apilados-pipeline-lambda-role \
  --policy-name ParameterStoreAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": [
        "arn:aws:ssm:*:*:parameter/apilados/*"
      ]
    }]
  }' \
  --profile production
```

## Compliance and Governance

### Data Classification

| Data Type | Classification | Encryption | Retention |
|-----------|---------------|------------|-----------|
| Participant Data | Confidential | AES-256 | 7 years |
| Processing Logs | Internal | AES-256 | 1 year |
| Health Reports | Internal | AES-256 | 90 days |
| Configuration | Restricted | KMS | Indefinite |

### Data Retention Policies

```bash
# Set S3 lifecycle policies
aws s3api put-bucket-lifecycle-configuration \
  --bucket apilados-production-data \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "DataRetention",
      "Status": "Enabled",
      "Filter": {"Prefix": "uploads/"},
      "Transitions": [{
        "Days": 30,
        "StorageClass": "STANDARD_IA"
      }, {
        "Days": 90,
        "StorageClass": "GLACIER"
      }],
      "Expiration": {
        "Days": 2555
      }
    }]
  }' \
  --profile production

# Set CloudWatch Logs retention
aws logs put-retention-policy \
  --log-group-name /aws/lambda/apilados-pipeline-ingest \
  --retention-in-days 365 \
  --profile production
```

### Compliance Monitoring

```bash
# Create compliance dashboard
aws cloudwatch put-dashboard \
  --dashboard-name "Apilados-Compliance" \
  --dashboard-body '{
    "widgets": [{
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/S3", "BucketSizeBytes", "BucketName", "apilados-production-data"],
          ["AWS/Lambda", "Errors", "FunctionName", "apilados-pipeline-ingest"]
        ],
        "period": 86400,
        "stat": "Average",
        "region": "us-east-1",
        "title": "Compliance Metrics"
      }
    }]
  }' \
  --profile production
```

## Security Testing

### Automated Security Scanning

```bash
# Install security scanning tools
npm install -g @aws-sdk/client-inspector2
npm install -g aws-cdk-security-scan

# Run CDK security scan
cdk-security-scan --stack ApiladosPipelineStack

# Run dependency vulnerability scan
npm audit --audit-level high
```

### Penetration Testing Checklist

1. **Authentication Testing**
   - [ ] API token validation
   - [ ] Token expiration handling
   - [ ] Invalid token rejection

2. **Authorization Testing**
   - [ ] IAM role permissions
   - [ ] Resource access controls
   - [ ] Cross-account access prevention

3. **Data Protection Testing**
   - [ ] Encryption at rest verification
   - [ ] Encryption in transit verification
   - [ ] Data leakage prevention

4. **Network Security Testing**
   - [ ] VPC configuration validation
   - [ ] Security group rules
   - [ ] Network ACL effectiveness

### Security Validation Scripts

```bash
#!/bin/bash
# security-validation.sh

echo "Running security validation..."

# Check S3 bucket encryption
echo "Checking S3 encryption..."
aws s3api get-bucket-encryption --bucket apilados-production-data

# Check Lambda environment encryption
echo "Checking Lambda encryption..."
aws lambda get-function-configuration --function-name apilados-pipeline-ingest --query 'KMSKeyArn'

# Check IAM policies
echo "Checking IAM policies..."
aws iam list-attached-role-policies --role-name apilados-pipeline-lambda-role

# Check CloudTrail status
echo "Checking CloudTrail..."
aws cloudtrail get-trail-status --name apilados-pipeline-audit

echo "Security validation complete."
```

## Incident Response

### Security Incident Response Plan

1. **Detection**
   - CloudWatch alarms trigger
   - Security team notification
   - Automated response initiation

2. **Containment**
   - Disable affected resources
   - Isolate compromised components
   - Preserve evidence

3. **Investigation**
   - Analyze CloudTrail logs
   - Review access patterns
   - Identify root cause

4. **Recovery**
   - Restore from secure backups
   - Apply security patches
   - Validate system integrity

5. **Lessons Learned**
   - Document incident
   - Update security controls
   - Improve monitoring

### Emergency Contacts

- **Security Team**: security@company.com
- **AWS Support**: Enterprise Support Case
- **Legal Team**: legal@company.com
- **Compliance Officer**: compliance@company.com

## Security Checklist

### Pre-Deployment Security Checklist

- [ ] IAM roles follow least privilege principle
- [ ] All data encrypted at rest and in transit
- [ ] CloudTrail enabled for audit logging
- [ ] Security groups configured restrictively
- [ ] Secrets stored in AWS Secrets Manager
- [ ] Vulnerability scanning completed
- [ ] Security policies documented
- [ ] Incident response plan in place

### Post-Deployment Security Checklist

- [ ] Security monitoring alerts configured
- [ ] Compliance dashboards created
- [ ] Regular security assessments scheduled
- [ ] Access reviews implemented
- [ ] Backup and recovery tested
- [ ] Security training completed
- [ ] Documentation updated
- [ ] Penetration testing scheduled

This security configuration guide ensures the Apilados Pipeline meets enterprise security standards and regulatory compliance requirements.