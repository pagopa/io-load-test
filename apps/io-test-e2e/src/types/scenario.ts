import { Client } from "k6/x/redis";
import { IConfig } from "../utils/config";
import { GeneratedKeypair } from "../utils/lollipop";

export type FeatureScenarioParams = {
  config: IConfig;
  key: GeneratedKeypair;
  REDIS_CLIENT: Client;
  token: string;
};
