# Automate deployment with Pulumi IAC
![alt](https://cdn-images-1.medium.com/max/2400/1*XHg217ET9evr3TK6uXPeFw.png)

This code in [index.js](index.js) deploys the above architecture

## Setup
1. Create your Pulumi account at Pulumi.com
2. Install all Pulumi dependencies

    ```bash
    npm install
    ```

## Review

Check [index.js](index.js) - it uses Nodejs to create all of the components in the architecture. 

For example:

### This stages the Cloud Run Function code to a GCS bucket
![alt text](https://cdn-images-1.medium.com/max/2400/1*RQCIsRHVLqRzl0bqRjPRBw.png)

### This deploys the Cloud Run Function
![alt text](https://cdn-images-1.medium.com/max/2400/1*ApgAvpWJWu1bLRZ3R09WeQ.png)

### This deploys the Firestore Database and adds a sample document
![alt text](https://cdn-images-1.medium.com/max/2400/1*NfnKzTiDNdVVoxydoPNUJQ.png)

## Deploy
Run the following command to deploy this entire architecture to Google Cloud. 
It will show you a diff of the resources that will be created and ask for you to confirm before proceeding.


```bash
pulumi up
```

![alt text](https://cdn-images-1.medium.com/max/1600/1*JHRAeJhvTJseq0mBPc04Fg.png)

## Review

Browse to your Pulumi dashboard to check results.