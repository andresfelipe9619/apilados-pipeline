# Cost Optimization & Infrastructure Enhancement Report: Apilados Pipeline

**Date:** September 7, 2025

## 1. Executive Summary

This report outlines the successful implementation of cost-saving measures and infrastructure enhancements for the Apilados Pipeline project. By optimizing our use of AWS resources, we have achieved significant cost reductions while launching a new, efficient microservice.

The key actions taken were:

- **Automating the start and stop of our EC2 instance using two new AWS Lambda functions.**
- **Launching a new, cost-effective, serverless microservice for data ingestion using AWS Lambda.**

These changes have resulted in an estimated **monthly savings of $11.53**, which represents a **25% reduction in the total operational cost** for the instance and its associated storage.

## 2. Background

The project's primary `t2.small` EC2 instance was running 24/7, leading to unnecessary costs during idle periods. Additionally, there was a need to introduce a new data ingestion service in a cost-effective and scalable manner.

## 3. Actions Taken

To address these points, we implemented the following changes:

- **EC2 Instance Automation:** We developed and deployed two new, specialized AWS Lambda functions (`start-ec2` and `stop-ec2`). These functions are triggered by a scheduler to automatically start the EC2 instance for its 8-hour daily operational window and shut it down afterward.

- **New Serverless Ingest Microservice:** We developed and launched a new, independent microservice for data ingestion using AWS Lambda. This serverless approach ensures that we only pay for compute time when data is being ingested (once per week), and it can scale automatically without requiring a dedicated, always-on server.

## 4. Cost Analysis

The primary cost savings come from reducing the runtime of the EC2 instance. The associated EBS storage cost remains constant as it is required to persist data regardless of whether the instance is running.

The table below provides a comprehensive breakdown of all costs associated with this part of the project:

| Component              | Before (Monthly Cost) | After (Monthly Cost) | Monthly Savings |
| ---------------------- | --------------------- | -------------------- | --------------- |
| **Compute Cost (EC2)** | **$17.11**            | **$5.58**            | **$11.53**      |
| **Storage Cost (EBS)** | $28.26                | $28.26               | $0.00           |
| **Total**              | **$45.37**            | **$33.84**           | **$11.53**      |

---

### Understanding the Percentages

- **67% Reduction in Compute Cost:** This significant percentage reflects the direct savings on the EC2 compute portion of the bill, which was the target of our optimization. We have successfully cut this specific cost by two-thirds.

- **25% Overall Reduction:** This percentage represents the impact on the total monthly bill for the instance and its storage. It is the most accurate reflection of the overall financial savings achieved.

## 5. Benefits & Impact

This initiative has delivered several key benefits:

- **Significant Cost Reduction:** We have achieved a **67% cost reduction** for the EC2 instance, leading to direct and recurring monthly savings.
- **Enhanced Automation:** The automated start/stop mechanism reduces manual overhead and ensures consistent and reliable resource management.
- **Scalable New Service:** The new ingest microservice is built on a modern, serverless architecture, allowing it to scale independently and cost-effectively without impacting other systems.
- **Sustainable Cloud Practices:** These changes align our project with AWS best practices for cost management and operational excellence.

## 6. Conclusion

This initiative has successfully reduced operational costs for our existing infrastructure while introducing a new, efficient microservice. The implemented changes improve our architecture, reduce manual effort, and demonstrate our commitment to building scalable and financially responsible solutions.
