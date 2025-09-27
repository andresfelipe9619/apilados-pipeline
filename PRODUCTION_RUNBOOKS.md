# Production Runbooks

## Overview

This document provides step-by-step troubleshooting procedures for common production issues with the Apilados Pipeline system. Each runbook includes symptoms, diagnosis steps, resolution procedures, and prevention measures.

## Table of Contents

1. [Lambda Function Issues](#lambda-function-issues)
2. [S3 Processing Issues](#s3-processing-issues)
3. [Memory and Performance Issues](#memory-and-performance-issues)
4. [API Connectivity Issues](#api-connectivity-issues)
5. [Health Monitoring Issues](#health-monitoring-issues)
6. [CCTs Processing Issues](#ccts-processing-issues)
7. [CloudWatch and Alerting Issues](#cloudwatch-and-alerting-issues)
8. [Security and Access Issues](#security-and-access-issues)

---

## Lambda Function Issues

### 🚨 Lambda Function Timeout

**Symptoms:**
- Lambda execution exceeds 15-minute timeout
- CloudWatch logs show "Task timed out after X seconds"
- Processing incomplete with partial results

**Diagnosis Steps:**
```bash
# Check recent lambda invocations
aws logs filter-log-events \
  --log-group-name /aws/lambda/apilados-pipeline-ingest \
  --start-time $(date -d '1 hour ago' +%s)000 \
  --filter-pattern "Task timed out" \
  --profile production

# Check lambda configuration
aws lambda get-function-configuration \
  --function-name apilados-pipeline-ingest \
  --profile production
```

**Resolution Steps:**
1. **Immediate Action:**
   ```bash
   # Increase lambda timeout (max 15 minutes)
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --timeout 900 \
     --profile production
   ```

2. **Optimize Processing:**
   ```bash
   # Reduce batch size for smaller chunks
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --environment Variables='{
       "BATCH_SIZE":"50",
       "CHUNK_SIZE":"100",
       "PROCESS_MODE":"parallel"
     }' \
     --profile production
   ```

3. **Monitor and Validate:**
   ```bash
   # Test with smaller file
   aws s3 cp small-test-file.csv s3://apilados-production-data/uploads/
   
   # Monitor execution time
   aws logs tail /aws/lambda/apilados-pipeline-ingest --follow
   ```

**Prevention:**
- Set up CloudWatch alarms for execution duration > 10 minutes
- Implement file size validation before processing
- Use CCTs on-demand mode for large datasets

---

### 🚨 Lambda Out of Memory

**Symptoms:**
- "Runtime exited with error: signal: killed" in logs
- Memory usage metrics showing 100% utilization
- Processing fails with large datasets

**Diagnosis Steps:**
```bash
# Check memory usage metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name MemoryUtilization \
  --dimensions Name=FunctionName,Value=apilados-pipeline-ingest \
  --start-time $(date -d '1 hour ago' --iso-8601) \
  --end-time $(date --iso-8601) \
  --period 300 \
  --statistics Maximum \
  --profile production

# Check lambda memory configuration
aws lambda get-function-configuration \
  --function-name apilados-pipeline-ingest \
  --query 'MemorySize' \
  --profile production
```

**Resolution Steps:**
1. **Immediate Action:**
   ```bash
   # Increase lambda memory
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --memory-size 1536 \
     --profile production
   ```

2. **Enable CCTs On-Demand Mode:**
   ```bash
   # Force on-demand mode for memory efficiency
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --environment Variables='{
       "CCTS_USE_PRELOADING":"false",
       "CCTS_MAX_MEMORY_MB":"256"
     }' \
     --profile production
   ```

3. **Optimize Processing:**
   ```bash
   # Reduce batch sizes
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --environment Variables='{
       "BATCH_SIZE":"25",
       "CHUNK_SIZE":"50"
     }' \
     --profile production
   ```

**Prevention:**
- Monitor memory usage with CloudWatch alarms
- Use health monitoring to track memory trends
- Implement automatic CCTs mode selection

---

## S3 Processing Issues

### 🚨 S3 Events Not Triggering Lambda

**Symptoms:**
- Files uploaded to S3 but lambda not executing
- No CloudWatch logs for recent uploads
- S3 event notifications not working

**Diagnosis Steps:**
```bash
# Check S3 event configuration
aws s3api get-bucket-notification-configuration \
  --bucket apilados-production-data \
  --profile production

# Check recent S3 uploads
aws s3 ls s3://apilados-production-data/uploads/ \
  --recursive \
  --human-readable \
  --profile production

# Check lambda event source mappings
aws lambda list-event-source-mappings \
  --function-name apilados-pipeline-ingest \
  --profile production
```

**Resolution Steps:**
1. **Verify S3 Event Configuration:**
   ```bash
   # Re-configure S3 event notifications
   aws s3api put-bucket-notification-configuration \
     --bucket apilados-production-data \
     --notification-configuration '{
       "LambdaConfigurations": [{
         "Id": "ProcessCSVFiles",
         "LambdaFunctionArn": "arn:aws:lambda:us-east-1:123456789012:function:apilados-pipeline-ingest",
         "Events": ["s3:ObjectCreated:*"],
         "Filter": {
           "Key": {
             "FilterRules": [{
               "Name": "prefix",
               "Value": "uploads/"
             }, {
               "Name": "suffix",
               "Value": ".csv"
             }]
           }
         }
       }]
     }' \
     --profile production
   ```

2. **Check Lambda Permissions:**
   ```bash
   # Add S3 invoke permission to lambda
   aws lambda add-permission \
     --function-name apilados-pipeline-ingest \
     --principal s3.amazonaws.com \
     --action lambda:InvokeFunction \
     --source-arn arn:aws:s3:::apilados-production-data \
     --statement-id s3-trigger \
     --profile production
   ```

3. **Test Event Processing:**
   ```bash
   # Upload test file
   echo "id,nombre,email" > test.csv
   echo "1,Test User,test@example.com" >> test.csv
   aws s3 cp test.csv s3://apilados-production-data/uploads/ --profile production
   
   # Monitor logs
   aws logs tail /aws/lambda/apilados-pipeline-ingest --follow --profile production
   ```

**Prevention:**
- Set up CloudWatch alarms for lambda invocation count
- Regular testing of S3 event triggers
- Monitor S3 access logs

---

### 🚨 S3 Access Denied Errors

**Symptoms:**
- "Access Denied" errors in lambda logs
- Unable to read/write S3 objects
- IAM permission issues

**Diagnosis Steps:**
```bash
# Check lambda execution role
aws lambda get-function-configuration \
  --function-name apilados-pipeline-ingest \
  --query 'Role' \
  --profile production

# Check role policies
aws iam list-attached-role-policies \
  --role-name apilados-pipeline-lambda-role \
  --profile production

# Test S3 access
aws s3 ls s3://apilados-production-data/ --profile production
```

**Resolution Steps:**
1. **Update IAM Policy:**
   ```bash
   # Create comprehensive S3 policy
   cat > s3-policy.json << EOF
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": [
         "s3:GetObject",
         "s3:PutObject",
         "s3:DeleteObject",
         "s3:ListBucket"
       ],
       "Resource": [
         "arn:aws:s3:::apilados-production-data",
         "arn:aws:s3:::apilados-production-data/*"
       ]
     }]
   }
   EOF
   
   # Attach policy to lambda role
   aws iam put-role-policy \
     --role-name apilados-pipeline-lambda-role \
     --policy-name S3AccessPolicy \
     --policy-document file://s3-policy.json \
     --profile production
   ```

2. **Verify Bucket Policies:**
   ```bash
   # Check bucket policy
   aws s3api get-bucket-policy \
     --bucket apilados-production-data \
     --profile production
   ```

**Prevention:**
- Regular IAM policy audits
- Use least-privilege access principles
- Monitor CloudTrail for access denied events

---

## Memory and Performance Issues

### 🚨 High Memory Usage with Large CCTs Files

**Symptoms:**
- Memory usage consistently above 80%
- CCTs pre-loading causing memory pressure
- Performance degradation with large datasets

**Diagnosis Steps:**
```bash
# Check CCTs configuration
aws lambda get-function-configuration \
  --function-name apilados-pipeline-ingest \
  --query 'Environment.Variables' \
  --profile production

# Check memory usage metrics
aws cloudwatch get-metric-statistics \
  --namespace Apilados/Pipeline/Production \
  --metric-name MemoryUsagePercentage \
  --start-time $(date -d '24 hours ago' --iso-8601) \
  --end-time $(date --iso-8601) \
  --period 3600 \
  --statistics Average,Maximum \
  --profile production
```

**Resolution Steps:**
1. **Force On-Demand CCTs Mode:**
   ```bash
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --environment Variables='{
       "CCTS_USE_PRELOADING":"false",
       "CCTS_MAX_MEMORY_MB":"256"
     }' \
     --profile production
   ```

2. **Optimize Memory Allocation:**
   ```bash
   # Increase lambda memory if needed
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --memory-size 1536 \
     --profile production
   ```

3. **Monitor Performance:**
   ```bash
   # Run health check to verify improvements
   cd lambda/ingest
   npm run health:check -- --environment production
   ```

**Prevention:**
- Set up memory usage alarms at 70% and 85%
- Regular monitoring of CCTs file sizes
- Implement automatic mode switching

---

### 🚨 Slow Processing Performance

**Symptoms:**
- Processing taking longer than expected
- High execution times in CloudWatch
- Timeout warnings in logs

**Diagnosis Steps:**
```bash
# Check execution time metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=apilados-pipeline-ingest \
  --start-time $(date -d '24 hours ago' --iso-8601) \
  --end-time $(date --iso-8601) \
  --period 3600 \
  --statistics Average,Maximum \
  --profile production

# Check processing configuration
aws lambda get-function-configuration \
  --function-name apilados-pipeline-ingest \
  --query 'Environment.Variables.PROCESS_MODE' \
  --profile production
```

**Resolution Steps:**
1. **Optimize Processing Mode:**
   ```bash
   # Enable parallel processing
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --environment Variables='{
       "PROCESS_MODE":"parallel",
       "BATCH_SIZE":"100",
       "OMIT_GET":"true"
     }' \
     --profile production
   ```

2. **Increase Lambda Resources:**
   ```bash
   # Increase memory (also increases CPU)
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --memory-size 1536 \
     --profile production
   ```

3. **Enable Provisioned Concurrency:**
   ```bash
   # Reduce cold start impact
   aws lambda put-provisioned-concurrency-config \
     --function-name apilados-pipeline-ingest \
     --provisioned-concurrency-config ProvisionedConcurrencyCount=2 \
     --profile production
   ```

**Prevention:**
- Set up performance monitoring dashboards
- Regular performance testing with production-sized datasets
- Implement performance regression alerts

---

## API Connectivity Issues

### 🚨 Strapi API Connection Failures

**Symptoms:**
- "Connection refused" or "Timeout" errors
- API health checks failing
- Processing failures due to API unavailability

**Diagnosis Steps:**
```bash
# Test API connectivity from lambda environment
aws lambda invoke \
  --function-name apilados-pipeline-ingest \
  --payload '{"test": "health-check"}' \
  --profile production \
  response.json

# Check API configuration
aws lambda get-function-configuration \
  --function-name apilados-pipeline-ingest \
  --query 'Environment.Variables.STRAPI_BASE_URL' \
  --profile production

# Run health check
cd lambda/ingest
npm run health:check -- --environment production
```

**Resolution Steps:**
1. **Verify API Configuration:**
   ```bash
   # Test API endpoint manually
   curl -H "Authorization: Bearer $STRAPI_TOKEN" \
        -H "Content-Type: application/json" \
        "$STRAPI_BASE_URL/encuestas?pagination[limit]=1"
   ```

2. **Update API Configuration:**
   ```bash
   # Update API endpoint if changed
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --environment Variables='{
       "STRAPI_BASE_URL":"https://new-api.production.com/api",
       "STRAPI_TOKEN":"new-production-token"
     }' \
     --profile production
   ```

3. **Implement Retry Logic:**
   ```bash
   # Enable retry mechanisms
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --environment Variables='{
       "API_RETRY_ATTEMPTS":"3",
       "API_RETRY_DELAY":"1000"
     }' \
     --profile production
   ```

**Prevention:**
- Set up API health monitoring
- Implement circuit breaker patterns
- Monitor API response times and error rates

---

### 🚨 Authentication Token Expiration

**Symptoms:**
- "401 Unauthorized" errors in logs
- Authentication failures after period of working correctly
- API calls being rejected

**Diagnosis Steps:**
```bash
# Check current token configuration
aws lambda get-function-configuration \
  --function-name apilados-pipeline-ingest \
  --query 'Environment.Variables.STRAPI_TOKEN' \
  --profile production

# Test token validity
curl -H "Authorization: Bearer $STRAPI_TOKEN" \
     -H "Content-Type: application/json" \
     "$STRAPI_BASE_URL/users/me"
```

**Resolution Steps:**
1. **Update Authentication Token:**
   ```bash
   # Get new token from Strapi admin
   # Update lambda environment
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --environment Variables='{
       "STRAPI_TOKEN":"new-valid-token"
     }' \
     --profile production
   ```

2. **Implement Token Rotation:**
   ```bash
   # Store token in AWS Secrets Manager
   aws secretsmanager create-secret \
     --name apilados-strapi-token \
     --description "Strapi API authentication token" \
     --secret-string '{"token":"your-token-here"}' \
     --profile production
   
   # Update lambda to use Secrets Manager
   # (Requires code changes to fetch from Secrets Manager)
   ```

**Prevention:**
- Set up token expiration monitoring
- Implement automatic token rotation
- Use long-lived service tokens where possible

---

## Health Monitoring Issues

### 🚨 Health Checks Failing

**Symptoms:**
- Health monitoring alerts being triggered
- CloudWatch metrics showing unhealthy status
- System components reporting as critical

**Diagnosis Steps:**
```bash
# Run comprehensive health check
cd lambda/ingest
npm run health:check -- --environment production --verbose

# Check CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace Apilados/Pipeline/Production \
  --metric-name OverallHealthStatus \
  --start-time $(date -d '1 hour ago' --iso-8601) \
  --end-time $(date --iso-8601) \
  --period 300 \
  --statistics Average \
  --profile production
```

**Resolution Steps:**
1. **Identify Failing Components:**
   ```bash
   # Get detailed health report
   npm run health:report -- --environment production --output health-debug.json
   
   # Review critical issues
   cat health-debug.json | jq '.health.checks[] | select(.status == "critical")'
   ```

2. **Address Specific Issues:**
   ```bash
   # Fix API connectivity issues
   npm run health:check -- --environment production --no-api
   
   # Check memory issues
   aws cloudwatch get-metric-statistics \
     --namespace Apilados/Pipeline/Production \
     --metric-name MemoryUsagePercentage \
     --start-time $(date -d '1 hour ago' --iso-8601) \
     --end-time $(date --iso-8601) \
     --period 300 \
     --statistics Maximum \
     --profile production
   ```

3. **Validate Resolution:**
   ```bash
   # Re-run health check
   npm run health:check -- --environment production
   
   # Monitor for improvements
   npm run health:monitor -- --environment production --interval 30
   ```

**Prevention:**
- Regular health check monitoring
- Automated health check scheduling
- Proactive threshold monitoring

---

## CCTs Processing Issues

### 🚨 CCTs Data Loading Failures

**Symptoms:**
- CCTs processing errors in logs
- Fallback to API calls for all CCTs
- Performance degradation due to missing CCTs optimization

**Diagnosis Steps:**
```bash
# Check CCTs configuration
aws lambda get-function-configuration \
  --function-name apilados-pipeline-ingest \
  --query 'Environment.Variables' \
  --profile production | grep CCTS

# Check S3 CCTs file
aws s3 ls s3://apilados-production-data/ccts_export.csv --profile production

# Test CCTs loading
cd lambda/ingest
npm run health:check -- --environment production --verbose
```

**Resolution Steps:**
1. **Verify CCTs File:**
   ```bash
   # Download and inspect CCTs file
   aws s3 cp s3://apilados-production-data/ccts_export.csv . --profile production
   head -5 ccts_export.csv
   wc -l ccts_export.csv
   ```

2. **Update CCTs Configuration:**
   ```bash
   # Ensure correct S3 configuration
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --environment Variables='{
       "CCTS_S3_BUCKET":"apilados-production-data",
       "CCTS_S3_KEY":"ccts_export.csv",
       "CCTS_USE_PRELOADING":"false"
     }' \
     --profile production
   ```

3. **Test CCTs Processing:**
   ```bash
   # Upload small test file to verify CCTs processing
   echo "id,nombre,email,cct_clave" > test-ccts.csv
   echo "1,Test User,test@example.com,01DJN0002D" >> test-ccts.csv
   aws s3 cp test-ccts.csv s3://apilados-production-data/uploads/ --profile production
   ```

**Prevention:**
- Regular CCTs file validation
- Monitor CCTs processing performance
- Set up alerts for CCTs loading failures

---

## CloudWatch and Alerting Issues

### 🚨 Missing CloudWatch Metrics

**Symptoms:**
- CloudWatch dashboard showing no data
- Missing custom metrics
- Alerts not triggering

**Diagnosis Steps:**
```bash
# Check if metrics are being sent
aws cloudwatch list-metrics \
  --namespace Apilados/Pipeline/Production \
  --profile production

# Check lambda permissions for CloudWatch
aws iam get-role-policy \
  --role-name apilados-pipeline-lambda-role \
  --policy-name CloudWatchPolicy \
  --profile production
```

**Resolution Steps:**
1. **Verify CloudWatch Permissions:**
   ```bash
   # Add CloudWatch permissions to lambda role
   cat > cloudwatch-policy.json << EOF
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": [
         "cloudwatch:PutMetricData",
         "logs:CreateLogGroup",
         "logs:CreateLogStream",
         "logs:PutLogEvents"
       ],
       "Resource": "*"
     }]
   }
   EOF
   
   aws iam put-role-policy \
     --role-name apilados-pipeline-lambda-role \
     --policy-name CloudWatchPolicy \
     --policy-document file://cloudwatch-policy.json \
     --profile production
   ```

2. **Enable Health Monitoring:**
   ```bash
   # Ensure health monitoring is enabled
   aws lambda update-function-configuration \
     --function-name apilados-pipeline-ingest \
     --environment Variables='{
       "HEALTH_CLOUDWATCH_NAMESPACE":"Apilados/Pipeline/Production",
       "HEALTH_CHECKS_ENABLED":"true"
     }' \
     --profile production
   ```

3. **Test Metric Sending:**
   ```bash
   # Trigger lambda to send metrics
   aws s3 cp test.csv s3://apilados-production-data/uploads/ --profile production
   
   # Wait and check for metrics
   sleep 300
   aws cloudwatch list-metrics \
     --namespace Apilados/Pipeline/Production \
     --profile production
   ```

**Prevention:**
- Regular monitoring of metric delivery
- Set up alerts for missing metrics
- Automated testing of monitoring systems

---

## Security and Access Issues

### 🚨 IAM Permission Errors

**Symptoms:**
- "Access denied" errors for AWS services
- Lambda unable to access required resources
- Security policy violations

**Diagnosis Steps:**
```bash
# Check lambda execution role
aws lambda get-function-configuration \
  --function-name apilados-pipeline-ingest \
  --query 'Role' \
  --profile production

# List all policies attached to role
aws iam list-attached-role-policies \
  --role-name apilados-pipeline-lambda-role \
  --profile production

# Check inline policies
aws iam list-role-policies \
  --role-name apilados-pipeline-lambda-role \
  --profile production
```

**Resolution Steps:**
1. **Review and Update Permissions:**
   ```bash
   # Create comprehensive policy
   cat > lambda-permissions.json << EOF
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:PutObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::apilados-production-data",
           "arn:aws:s3:::apilados-production-data/*"
         ]
       },
       {
         "Effect": "Allow",
         "Action": [
           "cloudwatch:PutMetricData",
           "logs:CreateLogGroup",
           "logs:CreateLogStream",
           "logs:PutLogEvents"
         ],
         "Resource": "*"
       },
       {
         "Effect": "Allow",
         "Action": [
           "sns:Publish"
         ],
         "Resource": "arn:aws:sns:*:*:apilados-pipeline-alerts"
       }
     ]
   }
   EOF
   
   aws iam put-role-policy \
     --role-name apilados-pipeline-lambda-role \
     --policy-name ComprehensivePolicy \
     --policy-document file://lambda-permissions.json \
     --profile production
   ```

2. **Test Permissions:**
   ```bash
   # Test lambda execution
   aws lambda invoke \
     --function-name apilados-pipeline-ingest \
     --payload '{"test": true}' \
     --profile production \
     response.json
   ```

**Prevention:**
- Regular IAM policy audits
- Use least-privilege principles
- Monitor CloudTrail for access denied events

---

## Emergency Procedures

### 🚨 Complete System Failure

**Immediate Actions:**
1. **Check System Status:**
   ```bash
   # Run comprehensive health check
   cd lambda/ingest
   npm run health:check -- --environment production --verbose
   ```

2. **Identify Root Cause:**
   ```bash
   # Check recent CloudWatch logs
   aws logs filter-log-events \
     --log-group-name /aws/lambda/apilados-pipeline-ingest \
     --start-time $(date -d '1 hour ago' +%s)000 \
     --filter-pattern "ERROR" \
     --profile production
   ```

3. **Implement Temporary Fix:**
   ```bash
   # Rollback to previous working version if needed
   aws lambda update-function-code \
     --function-name apilados-pipeline-ingest \
     --s3-bucket deployment-artifacts \
     --s3-key previous-working-version.zip \
     --profile production
   ```

4. **Notify Stakeholders:**
   ```bash
   # Send emergency notification
   aws sns publish \
     --topic-arn arn:aws:sns:us-east-1:123456789012:pipeline-alerts \
     --message "EMERGENCY: Apilados Pipeline system failure detected. Investigation in progress." \
     --subject "CRITICAL: System Failure" \
     --profile production
   ```

### 🚨 Data Processing Backlog

**Immediate Actions:**
1. **Assess Backlog:**
   ```bash
   # Check S3 for unprocessed files
   aws s3 ls s3://apilados-production-data/uploads/ \
     --recursive \
     --human-readable \
     --profile production
   ```

2. **Scale Processing:**
   ```bash
   # Increase lambda concurrency
   aws lambda put-concurrency \
     --function-name apilados-pipeline-ingest \
     --reserved-concurrent-executions 10 \
     --profile production
   ```

3. **Monitor Progress:**
   ```bash
   # Monitor processing progress
   aws logs tail /aws/lambda/apilados-pipeline-ingest --follow --profile production
   ```

---

## Escalation Procedures

### Level 1 - Operations Team
- **Trigger**: Automated alerts, monitoring thresholds exceeded
- **Response Time**: 15 minutes
- **Actions**: Follow runbook procedures, basic troubleshooting

### Level 2 - Development Team
- **Trigger**: Level 1 unable to resolve within 1 hour
- **Response Time**: 30 minutes
- **Actions**: Code-level debugging, advanced troubleshooting

### Level 3 - Architecture Team
- **Trigger**: System-wide issues, architectural changes needed
- **Response Time**: 1 hour
- **Actions**: Infrastructure changes, major system modifications

### Emergency Contacts
- **Operations On-Call**: +1-XXX-XXX-XXXX
- **Development Lead**: dev-lead@company.com
- **System Architect**: architect@company.com
- **Security Team**: security@company.com

This runbook provides comprehensive troubleshooting procedures for maintaining the Apilados Pipeline in production environments.