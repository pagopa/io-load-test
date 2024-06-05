## Load tests for fast-login feature
This project contains a `k6` load test related to the fast-login initiative.

## ENV variables required
Copy the `env.example` file into a newly created `.env` file and configure the variables needed.
The following list contains the required env variables to run the load test: 

| variable name          | description                                                   | type   |
| ---------------------- | ------------------------------------------------------------- | ------ |
| IO_BACKEND_BASE_URL    | Production url to the io-backend app service                  | string |
| IO_BACKEND_TEST_PASSWD | Password used for production test users                       | string |
| TEST_FISCAL_CODE       | Comma separated list of Fiscal Codes of production test users | string |



## How to launch the load test
First, you need to install k6 into the machine. You can follow [this link](https://k6.io/docs/get-started/installation/) for further info.

Next, you need to run the following command on the root directory to launch the load test locally:

```bash
./init.sh
```

## Load test diagrams
High level load test flow chart:
![High level load test flow chart](docs/high-level-diagram.svg)

Low level lollipop compatible keys generator logic:
![Low level lollipop compatible keys generator logic](docs/low-level-diagram-1.svg)

Low level k6 script logic:
![Low level k6 script logic](docs/low-level-diagram-2.svg)

## Rollout and test plan
**TODO**
