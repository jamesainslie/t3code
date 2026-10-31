// The production icon, as GitHub shows the Lathe app, whatever this build's channel.
import appIconUrl from "../../../../assets/prod/lathe-black-web-apple-touch-180.png";

export function LatheAppIcon(props: { readonly className?: string }) {
  return <img src={appIconUrl} alt="" className={props.className} />;
}
