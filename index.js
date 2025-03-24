const pulumi = require("@pulumi/pulumi");
const gcp = require("@pulumi/gcp");


const project = "gmao-test-project";

// 0. Create the Firestore DB
// https://www.pulumi.com/registry/packages/gcp/api-docs/firestore/database/
const database = new gcp.firestore.Database("pulumi-people-db", {
  name: "pulumi-people-db",
  locationId: "nam5",
  type: "FIRESTORE_NATIVE",
});

// Add a sample doc
const mydoc = new gcp.firestore.Document("iamgeorgeDoc", {
  database: database.name,
  collection: "person",
  documentId: "admin@iamgeorge.altostrat.com",
  fields: "{\"firstName\":{\"stringValue\":\"George\"},\"lastName\":{\"stringValue\":\"Mao\"},\"email\":{\"stringValue\":\"admin@iamgeorge.altostrat.com\"}}"
});

// Create a new Service Account for the Functions
const serviceAccount = new gcp.serviceaccount.Account("pulumiTestSA", {
  accountId: "pulumi-test-func-sa",
  displayName: "Service Account for Pulumi Test Functions",
});

// Bind the Firestore User role to the service account
// https://www.pulumi.com/registry/packages/gcp/api-docs/projects/iambinding/
new gcp.projects.IAMBinding("project-binding", {
  project: project,
  role: "roles/datastore.user",
  members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
});


// Create a bucket to deploy the function's deployment zip
const bucket = new gcp.storage.Bucket("bucket", {
    name: `${project}-gcf-source`,
    location: "US",
    uniformBucketLevelAccess: true,
});

// Deploy zipped function package
const object = new gcp.storage.BucketObject("object", {
    name: "function-source.zip",
    bucket: bucket.name,
    source: new pulumi.asset.FileAsset("../concurrency-demo/function-source.zip"),
});

// Create all functions
// https://www.pulumi.com/registry/packages/gcp/api-docs/cloudfunctionsv2/function/
const _function = new gcp.cloudfunctionsv2.Function("function", {
    name: "pulumi-test-func",
    location: "us-central1",
    description: "a new function",
    buildConfig: {
        runtime: "nodejs22",
        entryPoint: "helloHttp",
        source: {
            storageSource: {
                bucket: bucket.name,
                object: object.name,
            },
        },
    },
    serviceConfig: {
        maxInstanceCount: 1,
        availableMemory: "256M",
        timeoutSeconds: 60,
        ingressSettings: "ALLOW_INTERNAL_AND_GCLB",
        environmentVariables: {
          FIREBASE_DB_NAME: database.name
        },
        serviceAccountEmail: serviceAccount.email

    },
});

const _function2 = new gcp.cloudfunctionsv2.Function("function2", {
    name: "pulumi-test-func",
    location: "us-east4",
    description: "a new function",
    buildConfig: {
        runtime: "nodejs22",
        entryPoint: "helloHttp",
        source: {
            storageSource: {
                bucket: bucket.name,
                object: object.name,
            },
        },
    },
    serviceConfig: {
        maxInstanceCount: 1,
        availableMemory: "256M",
        timeoutSeconds: 60,
        ingressSettings: "ALLOW_INTERNAL_AND_GCLB",
        environmentVariables: {
          FIREBASE_DB_NAME: database.name
        },
        serviceAccountEmail: serviceAccount.email
    },
});

// Open function to public unrestricted access -- this is safe because we only allow internal/ALB ingress
// https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrun/iammember/
const publicAccessFunction = new gcp.cloudrun.IamMember(`function-public-invoker`, {
    region: _function.region,
    location: _function.location,
    service: _function.name,
    role: "roles/run.invoker",
    member: "allUsers",
});

// Open function2 to public unrestricted access -- this is safe because we only allow internal/ALB ingress
const publicAccessFunction2 = new gcp.cloudrun.IamMember(`function2-public-invoker`, {
    region: _function2.region,
    location: _function2.location,
    service: _function2.name,
    role: "roles/run.invoker",
    member: "allUsers",
});

// Create Global External ALB requires: 
// External IP --> Forwarding Rule + HTTPS Proxy --> URL Map --> Backend Service --> [Serverless NEG --> Function]

// 0. A global static anycast IP
// https://www.pulumi.com/registry/packages/gcp/api-docs/compute/globaladdress/
const ipaddress = new gcp.compute.GlobalAddress('pulumi-galb-ipaddress', {
    addressType: 'EXTERNAL',
  })

// 1.  Create Serverless NEG --> Cloud Run Function (us-central1)
// https://www.pulumi.com/registry/packages/gcp/api-docs/compute/regionnetworkendpointgroup/
const centralSNEG = new gcp.compute.RegionNetworkEndpointGroup('pulumi-galb-sneg-central1', {
    networkEndpointType: 'SERVERLESS',
    region: 'us-central1',
    cloudFunction: {
      "function": _function.name,
    }
})

const eastSNEG = new gcp.compute.RegionNetworkEndpointGroup('pulumi-galb-sneg-east4', {
    networkEndpointType: 'SERVERLESS',
    region: 'us-east4',
    cloudFunction: {
      "function": _function2.name,
    }
})

// 2. Create BackendEnd Service --> add all Serverless NEGs
// https://www.pulumi.com/registry/packages/gcp/api-docs/compute/backendservice/
const service = new gcp.compute.BackendService('pulumi-galb-backend-service', {
    enableCdn: false,
    connectionDrainingTimeoutSec: 10,
    loadBalancingScheme: "EXTERNAL_MANAGED", // Must set this to create a GXALB or a Classic LB will be created. Default is EXTERNAL
    protocol: "HTTPS",
    backends: [
      {
        group: eastSNEG.id
      },
      {
        group: centralSNEG.id
      }
    ],
  })

// 3. Create URL Map -- enables certificates and constructs path mappings
const https_paths = new gcp.compute.URLMap('pulumi-my-service-https', {
    defaultService: service.id,
    hostRules: [
      {
        hosts: ['app.iamgeorge.demo.altostrat.com'],
        pathMatcher: 'all-paths',
      },
    ],
    pathMatchers: [
      {
        name: 'all-paths',
        defaultService: service.id,
        pathRules: [
          {
            paths: ['/*'],
            service: service.id,
          },
        ],
      },
    ],
  })

// 4. Create Certificate + Target HTTPS Proxy + Forwarding Rule
const certificate = new gcp.compute.ManagedSslCertificate(
    'my-customdomain-certificate',
    {
      managed: {
        domains: ['app.iamgeorge.demo.altostrat.com'],
      },
    }
  )

const https_proxy = new gcp.compute.TargetHttpsProxy('pulumi-galb-https-proxy', {
    urlMap: https_paths.selfLink,
    sslCertificates: [certificate.id],
  })
  
// 5. Create the Global external ALB
// NOTE: You must add a DNS entry (A record) that points to the ALB IP address in order to activate the cert for use
// https://www.pulumi.com/registry/packages/gcp/api-docs/compute/globalforwardingrule/#loadbalancingscheme_nodejs
new gcp.compute.GlobalForwardingRule('pulumi-galb-https', {
    target: https_proxy.selfLink,
    ipAddress: ipaddress.address,
    portRange: '443',
    loadBalancingScheme: 'EXTERNAL_MANAGED' // Must set this. Default is EXTERNAL
})

  
exports.uscentralurl = _function.url;
exports.useasturl = _function2.url;
exports.galbip = ipaddress.address