import { FeatureScenarioType } from "../utils/config";
import { loadingServicesAppTab } from "./bonus";
import { loadingCgnDataPortfolioTab } from "./cgn";
import { appOpening } from "./landing";
import { messageListAndDetail } from "./messages";
import { loadingOnlyServicesAppTab } from "./services";
import { trialSubscription } from "./trial";
import { walletInstanceCreation } from "./wallet";

export const getFeatureScenario = (scenarioType: FeatureScenarioType) => {
  switch (scenarioType) {
    case "APP_OPENING":
      return appOpening;
    case "TRIAL":
      return trialSubscription;
    case "MESSAGE_DETAIL":
      return messageListAndDetail;
    case "WALLET":
      return walletInstanceCreation;
    case "BONUS":
      return loadingServicesAppTab;
    case "SERVICES":
      return loadingOnlyServicesAppTab;
    case "CGN":
      return loadingCgnDataPortfolioTab;
  }
};
