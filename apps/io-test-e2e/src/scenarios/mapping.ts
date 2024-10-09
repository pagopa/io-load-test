import { FeatureScenarioType } from "../utils/config";
import { messageListAndDetail } from "./messages";
import { trialSubscription } from "./trial";
import { walletInstanceCreation } from "./wallet";

export const getFeatureScenario = (scenarioType: FeatureScenarioType) => {
  switch (scenarioType) {
    case "TRIAL":
      return trialSubscription;
    case "MESSAGE_DETAIL":
      return messageListAndDetail;
    case "WALLET":
      return walletInstanceCreation;
  }
};
