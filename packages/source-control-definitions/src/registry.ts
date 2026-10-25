import * as AzureDevOps from "@lathe/source-control-azure-devops/shared/definition";
import * as Bitbucket from "@lathe/source-control-bitbucket/shared/definition";
import { makeSourceControlDefinitionRegistry } from "@lathe/source-control-core/shared/definition";
import * as Forgejo from "@lathe/source-control-forgejo/shared/definition";
import * as GitCafe from "@lathe/source-control-gitcafe/shared/definition";
import * as GitHub from "@lathe/source-control-github/shared/definition";
import * as GitLab from "@lathe/source-control-gitlab/shared/definition";

/**
 * The server and every client read hosts through this one registry, so they agree on which host
 * owns a URL or remote. GitHub comes first because a repository that has not reported its host
 * yet reads as GitHub, which is what clients have always shown there. A change request URL goes
 * to the first host whose shape it has, so GitCafe, which claims `/pull/` and `/pulls/` only on
 * its own hostnames, claims before GitHub and Forgejo, which claim them everywhere. A hostname can
 * carry more than one host's label (`gitea.github.example`), so remote recognition has its own
 * order.
 */
export const builtInSourceControlDefinitions = makeSourceControlDefinitionRegistry(
  [
    GitHub.definition,
    GitLab.definition,
    GitCafe.definition,
    Forgejo.definition,
    Bitbucket.definition,
    AzureDevOps.definition,
  ],
  {
    claimChangeRequestUrlsFirst: [GitCafe.definition.kind],
    recognizeRemotesIn: [
      GitCafe.definition.kind,
      Forgejo.definition.kind,
      GitHub.definition.kind,
      GitLab.definition.kind,
      AzureDevOps.definition.kind,
      Bitbucket.definition.kind,
    ],
  },
);
