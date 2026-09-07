import { routerAttestation, routerRekor, rekorPublicUrl } from "@/lib/upstream";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AttestationPage() {
  const [att, anchor] = await Promise.all([
    routerAttestation().catch(() => null),
    routerRekor().catch(() => null),
  ]);

  return (
    <main>
      <section className="hero">
        <div className="kicker">Where the trust stops</div>
        <h1>The gateway proves what it is running, to hardware and to a public log.</h1>
        <p className="lede">
          A receipt is only as good as the thing that wrote it. The Sumplus gateway runs inside an
          AMD SEV-SNP confidential machine and publishes a hardware report plus the head of its own
          call chain. This page reads both live from production.
        </p>
      </section>

      <h2>Hardware report</h2>
      {att ? (
        <div className="panel scroll-x">
          <table>
            <tbody>
              <tr>
                <th style={{ width: 190 }}>Mode</th>
                <td>
                  <span className="tag ok">{att.mode}</span>
                </td>
              </tr>
              <tr>
                <th>Measurement</th>
                <td className="mono">{att.measurement}</td>
              </tr>
              <tr>
                <th>Binary</th>
                <td className="mono">{att.build.binary_sha256}</td>
              </tr>
              <tr>
                <th>Model list digest</th>
                <td className="mono">{att.build.models_digest}</td>
              </tr>
              <tr>
                <th>Provider list digest</th>
                <td className="mono">{att.build.providers_digest}</td>
              </tr>
              <tr>
                <th>Uptime</th>
                <td>{Math.floor(att.uptime_seconds / 3600)} hours</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            The attestation endpoint did not answer on this request. Read it directly at{" "}
            <span className="mono">https://router.sumplus.xyz/attestation</span>.
          </p>
        </div>
      )}

      <h2>Public anchor</h2>
      {anchor ? (
        <div className="panel">
          <p style={{ margin: "0 0 10px" }}>
            The chain head is published to Sigstore Rekor. That log runs outside Sumplus, so an entry
            once written cannot be quietly revised by the party it describes.
          </p>
          <div className="scroll-x">
            <table>
              <tbody>
                <tr>
                  <th style={{ width: 190 }}>Log index</th>
                  <td className="mono">{anchor.rekor.log_index}</td>
                </tr>
                <tr>
                  <th>Entry</th>
                  <td className="mono">{anchor.rekor.uuid}</td>
                </tr>
                <tr>
                  <th>Log</th>
                  <td className="mono">{anchor.rekor.rekor_url}</td>
                </tr>
                <tr>
                  <th>Measurement anchored</th>
                  <td className="mono">{anchor.rekor.anchored_entry.measurement}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ margin: "14px 0 0" }}>
            <a href={rekorPublicUrl(anchor.rekor.log_index)} target="_blank" rel="noreferrer">
              Look this entry up on sigstore.dev
            </a>
          </p>
        </div>
      ) : (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            The anchor endpoint did not answer on this request. Read it directly at{" "}
            <span className="mono">https://router.sumplus.xyz/v1/rekor</span>.
          </p>
        </div>
      )}

      <div className="callout">
        Check it without this page:
        <p className="mono" style={{ margin: "8px 0 0" }}>
          curl -s https://router.sumplus.xyz/attestation
        </p>
        <p className="mono" style={{ margin: 0 }}>
          curl -s https://router.sumplus.xyz/v1/rekor
        </p>
      </div>

      <footer className="foot">
        Prompt and response bodies are not stored. Receipts carry metadata, token counts, costs and
        hashes.
      </footer>
    </main>
  );
}
