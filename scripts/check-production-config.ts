import {
  productionConfigurationErrors,
  teacherResetPreconditionConfigurationErrors,
} from "../src/lib/production-config";

const errors = [
  ...productionConfigurationErrors(process.env),
  ...teacherResetPreconditionConfigurationErrors(process.env),
];
if (errors.length > 0) {
  for (const error of errors) console.error(`production configuration: ${error}`);
  process.exit(1);
}
console.log("Production security configuration is valid.");
