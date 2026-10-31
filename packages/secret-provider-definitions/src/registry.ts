import { makeSecretProviderDefinitionRegistry } from "@lathe/secret-provider-core/shared/definition";
import * as OnePassword from "@lathe/secret-provider-onepassword/shared/definition";

export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  OnePassword.definition,
]);
