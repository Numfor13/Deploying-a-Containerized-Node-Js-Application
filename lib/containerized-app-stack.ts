import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as apigw2 from "aws-cdk-lib/aws-apigatewayv2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { HttpAlbIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations"; //research

export const PREFIX = "eda-ecs";

export class ContainerizedAppStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    ecrRepository: ecr.Repository,
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "node-app-vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"), //are we the ones defining this? is it a standard or gotten from somewhere? and can it be changed?
      maxAzs: 2,
      vpcName: `${PREFIX}-vpc`,
      restrictDefaultSecurityGroup: false, //explain this and check on the console
    });

    const cluster = new ecs.Cluster(this, "EdaCluster", {
      vpc: vpc,
      clusterName: `${PREFIX}-cluster`,
    });

    // Create a load-balanced Fargate service and make it public
    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "EdaFargateService",
      {
        cluster: cluster,
        cpu: 256,
        serviceName: `${PREFIX}-service`,
        loadBalancerName: `${PREFIX}-alb-eda`,
        desiredCount: 2,
        taskImageOptions: {
          image: ecs.ContainerImage.fromEcrRepository(ecrRepository, "latest"),
          environment: {
            ENV_VAR_1: "value1",
            ENV_VAR_2: "value2",
          },
          containerPort: 80,
        },
        memoryLimitMiB: 512,
        publicLoadBalancer: true,
      }
    );

    ecrRepository.grantPull(service.taskDefinition.obtainExecutionRole());

    const scaling = service.service.autoScaleTaskCount({
      maxCapacity: 5,
      minCapacity: 1,
    });
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 70,
    }); // default cooldown of 5 min
    scaling.scaleOnMemoryUtilization("RamScaling", {
      targetUtilizationPercent: 70,
    }); // default cooldown of 5 min

    service.targetGroup.configureHealthCheck({
      path: "/",
      healthyHttpCodes: "200",
    });

    const httpApi = new apigw2.HttpApi(this, "HttpApi", {
      apiName: `${PREFIX}-api`,
    });

    httpApi.addRoutes({
      path: "/",
      methods: [apigw2.HttpMethod.GET],
      integration: new HttpAlbIntegration("AlbIntegration", service.listener),
    });
  }
}