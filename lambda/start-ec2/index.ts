import {EC2Client, StartInstancesCommand} from '@aws-sdk/client-ec2';

const ec2 = new EC2Client({});
export const handler = async () => {
    const ids: string[] = JSON.parse(process.env.INSTANCE_IDS || '[]');
    if (!ids.length) return;
    await ec2.send(new StartInstancesCommand({InstanceIds: ids}));
    console.log('Started', ids);
};