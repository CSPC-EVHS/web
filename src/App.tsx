import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styled from "styled-components";
import { FaBalanceScale, FaDatabase, FaHeartbeat, FaLock } from "react-icons/fa";
import ecgData from "./ecg_sample_shrunk.json";
import {
  LOCKED_HR_BPM,
  PRIOR_ALPHA,
  PRIOR_BETA,
  PRIOR_MEAN,
  PRIOR_STRENGTH,
  analyzeJson,
  densitySeries,
  interceptLogLik,
  type Fit,
  type Report,
  type ScoredWindow,
} from "./analysis";
import { Tex } from "./Tex";

const Page = styled.main`
  --ink: #1c1915;
  --muted: #5c5348;
  --line: #e4d9c6;
  --paper: #f3eee4;
  --card: #fffdf8;
  --red: #9d1c2b;
  --teal: #0f6e6b;
  max-width: 980px;
  margin: 0 auto;
  padding: 28px 18px 64px;
  color: var(--ink);
`;

const Kicker = styled.p`
  margin: 0 0 8px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  color: var(--red);
`;

const Title = styled.h1`
  margin: 0 0 12px;
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.15;
  font-weight: 600;
`;

const Lead = styled.p`
  margin: 0;
  font-size: 18px;
  line-height: 1.5;
  max-width: 68ch;
`;

const Section = styled.section`
  margin-top: 28px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 18px 18px 16px;
`;

const Heading = styled.h2`
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 600;

  svg {
    color: var(--red);
    flex: 0 0 auto;
  }
`;

const Prose = styled.p`
  margin: 8px 0;
  line-height: 1.55;
  font-size: 16.5px;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 12px 0;

  @media (max-width: 620px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 390px) {
    grid-template-columns: 1fr;
  }
`;

const Stat = styled.div`
  background: #f7f2e8;
  border-radius: 12px;
  padding: 10px 12px;

  span {
    display: block;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  strong {
    display: block;
    margin-top: 4px;
    font-size: 22px;
    font-variant-numeric: tabular-nums;
  }
`;

const ChartBox = styled.div`
  width: 100%;
  height: 300px;
  margin-top: 8px;
`;

const WaveformChartBox = styled(ChartBox)`
  position: relative;
`;

const WaveformReadout = styled.div`
  position: absolute;
  top: 16px;
  right: 18px;
  z-index: 1;
  pointer-events: none;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
`;

const WindowChartBox = styled(ChartBox)`
  height: 320px;
`;

const Note = styled.p`
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.45;
`;

const Banner = styled.div`
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8e7df;
  color: #6d2418;
  line-height: 1.4;
`;

const TableWrap = styled.div`
  overflow-x: auto;
  margin-top: 12px;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  font-variant-numeric: tabular-nums;

  th,
  td {
    text-align: left;
    padding: 7px 8px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }

  th {
    color: var(--muted);
    font-weight: 600;
  }

  tr[data-split="test"] td:first-child {
    box-shadow: inset 3px 0 0 var(--teal);
  }
`;

const List = styled.ul`
  margin: 8px 0 0;
  padding-left: 18px;
  line-height: 1.5;
`;

function fmt(value: number | null, digits = 3): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function nearestWaveformPoint(points: Array<{ t: number; mV: number }>, time: number) {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].t < time) low = middle + 1;
    else high = middle;
  }
  const after = points[low];
  const before = points[Math.max(0, low - 1)];
  return Math.abs(before.t - time) <= Math.abs(after.t - time) ? before : after;
}

function FitStats({ fit, title, mark = false }: { fit: Fit; title: string; mark?: boolean }) {
  return (
    <>
      <Prose>{title}</Prose>
      <Grid>
        <Stat>
          <span>Train alerts</span>
          <strong>
            {fit.trainK}/{fit.trainN}
          </strong>
        </Stat>
        <Stat>
          <span>Posterior mean</span>
          <strong data-testid={mark ? "posterior-mean" : undefined}>{fmt(fit.mean)}</strong>
        </Stat>
        <Stat>
          <span>95% interval</span>
          <strong>
            {fmt(fit.lower)}–{fmt(fit.upper)}
          </strong>
        </Stat>
        <Stat>
          <span>Test alerts</span>
          <strong data-testid={mark ? "test-alerts" : undefined}>
            {fit.testK}/{fit.testN}
          </strong>
        </Stat>
        <Stat>
          <span>Test Brier</span>
          <strong data-testid={mark ? "test-brier" : undefined}>{fmt(fit.brier)}</strong>
        </Stat>
        <Stat>
          <span>Test log loss</span>
          <strong>{fmt(fit.logLoss)}</strong>
        </Stat>
      </Grid>
    </>
  );
}

function App() {
  const report = useMemo<Report>(() => analyzeJson(ecgData), []);
  const [waveformPoint, setWaveformPoint] = useState<{ t: number; mV: number } | null>(null);
  const density = useMemo(() => {
    if (!report.locked) return [];
    const prior = densitySeries(PRIOR_ALPHA, PRIOR_BETA);
    const post = densitySeries(report.locked.alpha, report.locked.beta);
    return prior.map((point, index) => ({
      x: point.x,
      prior: point.density,
      posterior: post[index]?.density ?? 0,
    }));
  }, [report.locked]);

  if (report.error) {
    return (
      <Page>
        <Kicker>ECG window alert</Kicker>
        <Title>The recording could not be scored.</Title>
        <Banner>{report.error}</Banner>
        <Note>
          {report.skipped} row{report.skipped === 1 ? "" : "s"} skipped. {report.nSamples} numeric samples kept.
        </Note>
      </Page>
    );
  }

  const fit = report.locked;
  return (
    <Page>
      <Kicker>One-minute ECG · window alert</Kicker>
      <Title>How often would a 5-second window from this strip trip a fast-or-irregular alert?</Title>
      <Lead>
        The alert fires when the window heart rate is above {LOCKED_HR_BPM} BPM, or when an RR interval in that window
        sits more than 20% away from the window’s own median RR. The quantity to estimate is the probability
        of that event on a new window from this same recording.
      </Lead>

      <Section>
        <Heading>Scope</Heading>
        <Prose>
          This is the chance that another 5-second window from this one-lead recording triggers the rule.
          It is not a diagnosis or a population estimate.
        </Prose>
      </Section>

      <Section>
        <Heading>
          <FaBalanceScale aria-hidden /> Prior, written before the fit
        </Heading>
        <Prose>
          Before using this file, the guess for the window probability was <strong>{PRIOR_MEAN.toFixed(2)}</strong>.
          Confidence was <strong>low</strong>. Resting adult rates often sit between about 60 and 90 BPM, so
          crossing 85 is plausible and not the usual case. A 20% RR departure is uncommon on a quiet strip,
          but the alert counts either condition. The setting of the recording — rest, effort, or an irregular
          rhythm — was unknown, so a narrow prior would have been invented certainty.
        </Prose>
        <Prose>
          That guess is encoded as {PRIOR_STRENGTH} pseudo-windows: {PRIOR_ALPHA.toFixed(2)} imaginary alerts
          and {PRIOR_BETA.toFixed(2)} imaginary quiet windows.
        </Prose>
        <Tex block expr={`\\theta \\sim \\mathrm{Beta}(${PRIOR_ALPHA.toFixed(2)},\\ ${PRIOR_BETA.toFixed(2)}),\\quad \\mathbb{E}[\\theta]=${PRIOR_MEAN.toFixed(2)}`} />
        {fit && (
          <Note>
            Central 95% prior interval: {fmt(fit.priorLower)} to {fmt(fit.priorUpper)}. The prior is not
            edited after the zeros and ones are counted.
          </Note>
        )}
      </Section>

      <Section>
        <Heading>
          <FaDatabase aria-hidden /> Data
        </Heading>
        <Prose>
          The app reads <code>ecg_sample_shrunk.json</code> from the same folder as this screen. Nothing is
          downloaded. Columns used: Time (ms) and Amplitude (mV). Blank lines, NaN, and non-numeric cells are
          dropped. A timestamp that does not move forward is dropped, so a corrupt clock cannot be sorted into
          a fake beat.
        </Prose>
        <Grid>
          <Stat>
            <span>Samples kept</span>
            <strong>{report.nSamples}</strong>
          </Stat>
          <Stat>
            <span>Rows skipped</span>
            <strong>{report.skipped}</strong>
          </Stat>
          <Stat>
            <span>Duration</span>
            <strong>{fmt(report.durationS, 1)} s</strong>
          </Stat>
          <Stat>
            <span>Sample rate</span>
            <strong>{fmt(report.fsHz, 1)} Hz</strong>
          </Stat>
          <Stat>
            <span>R peaks</span>
            <strong>{report.nPeaks}</strong>
          </Stat>
          <Stat>
            <span>Mean rate</span>
            <strong>{fmt(report.meanHr, 1)} BPM</strong>
          </Stat>
        </Grid>
        <Tex block expr={"f_s = 1000 / \\mathrm{median}(\\Delta t)"} />
        {report.timingWarning && (
          <Banner>Sample spacing is uneven. Peak timing on this file is less trustworthy.</Banner>
        )}
        {report.skipped > 0 && (
          <Banner>{report.skipped} malformed rows were skipped. Charts use the remaining samples.</Banner>
        )}
        <WaveformChartBox
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const plotLeft = 70;
            const plotRight = bounds.width - 12;
            const x = event.clientX - bounds.left;
            if (x < plotLeft || x > plotRight || plotRight <= plotLeft) {
              setWaveformPoint(null);
              return;
            }
            const targetTime = ((x - plotLeft) / (plotRight - plotLeft)) * 60;
            const next = nearestWaveformPoint(report.trace, targetTime);
            setWaveformPoint((current) => (current?.t === next.t ? current : next));
          }}
          onMouseLeave={() => setWaveformPoint(null)}
        >
          {waveformPoint && (
            <WaveformReadout>
              <div>{waveformPoint.t.toFixed(2)} s</div>
              <div>{waveformPoint.mV.toFixed(2)} mV</div>
            </WaveformReadout>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={report.trace} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#efe6d6" />
              <XAxis dataKey="t" type="number" domain={[0, 60]} tickFormatter={(value) => `${value}s`} />
              <YAxis width={70} />
              <ReferenceArea x1={40} x2={60} fill="#0f6e6b" fillOpacity={0.16} />
              <Line
                dataKey="mV"
                stroke="#9d1c2b"
                dot={false}
                activeDot={false}
                strokeWidth={1.4}
                isAnimationActive={false}
              />
              {waveformPoint && (
                <ReferenceDot
                  x={waveformPoint.t}
                  y={waveformPoint.mV}
                  r={4}
                  fill="#9d1c2b"
                  stroke="#fffdf8"
                  strokeWidth={1.5}
                />
              )}
              <Scatter
                data={report.peaks}
                dataKey="mV"
                fill="#1c1915"
                name="R peak"
                tooltipType="none"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </WaveformChartBox>
        <Note>
          Black dots are detected R peaks. The teal band is the locked last 20 seconds. Hovering shows the
          nearest trace time and amplitude; the trace is a min/max
          sketch of the samples so the tall QRS spikes stay visible.
        </Note>
      </Section>

      <Section>
        <Heading>
          <FaHeartbeat aria-hidden /> Model
        </Heading>
        <Prose>
          The strip is cut into non-overlapping 5-second windows. Five minutes would be one bin on a
          one-minute file, which cannot support a probability. R peaks are local maxima on a 0.2-second
          moving-average detrend, at least 0.4 seconds apart, and at least half a standard deviation tall.
          An RR interval is the time between successive peaks. Intervals shorter than 0.25 seconds or longer
          than 2.5 seconds are treated as detector errors and are not called irregular beats.
        </Prose>
        <Prose>
          A window with fewer than two kept intervals is unscored. Otherwise the window heart rate is 60
          divided by the mean RR, and the irregularity score is the largest relative distance from the
          window median RR. The alert is the OR of those two checks.
        </Prose>
        <Tex
          block
          expr={
            "Y_w=1\\left\\{\\overline{HR}_w>85\\ \\mathrm{or}\\ \\max_i\\frac{|RR_{w,i}-\\mathrm{median}|}{\\mathrm{median}}>0.20\\right\\}"
          }
        />
        <Prose>
          Each scored window is a Bernoulli trial with unknown probability θ. The training count of alerts,
          k, out of n scored training windows updates the beta prior by adding counts. There is no optimizer.
          The probability quoted for a new window is the posterior mean.
        </Prose>
        <Tex
          block
          expr={
            "\\theta\\mid k,n\\sim\\mathrm{Beta}(\\alpha_0+k,\\ \\beta_0+n-k),\\quad \\hat p=\\frac{\\alpha_0+k}{\\alpha_0+\\beta_0+n}"
          }
        />
        <WindowChartBox>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={report.lockedWindows} margin={{ top: 32, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#efe6d6" />
              <XAxis dataKey="index" tickFormatter={(value) => `${Number(value) * 5}s`} />
              <YAxis domain={[0, 110]} width={48} />
              <Tooltip
                cursor={{ fill: "rgba(92, 83, 72, 0.12)" }}
                formatter={(value) => [`${Number(value).toFixed(1)} BPM`, "Mean HR"]}
                labelFormatter={(label) => `Window at ${Number(label) * 5}s`}
              />
              <ReferenceLine
                y={LOCKED_HR_BPM}
                stroke="#9d1c2b"
                strokeDasharray="4 4"
                label={{ value: "85 BPM", fill: "#9d1c2b", position: "insideTopRight" }}
              />
              <Bar dataKey="meanHr" isAnimationActive={false}>
                {report.lockedWindows.map((window) => (
                  <Cell key={window.index} fill={window.split === "test" ? "#0f6e6b" : "#c4b49a"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </WindowChartBox>
        <Note>
          Stone bars are training windows; teal bars are the locked test. The gray hover band marks only the
          window being inspected. Every window on this strip sits
          near {fmt(report.minInstHr, 0)}–{fmt(report.maxInstHr, 0)} BPM. Instantaneous rate never crosses 85
          either (fastest interval {fmt(report.maxInstHr, 1)} BPM). The largest RR departure from the strip
          median is {pct(report.maxRelDev)}, against a 20% rule. Coefficient of variation of RR is{" "}
          {pct(report.rrCv)}.
        </Note>
        <WindowTable windows={report.lockedWindows} />
      </Section>

      {fit && (
        <Section>
          <Heading>
            <FaLock aria-hidden /> Locked test
          </Heading>
          <FitStats
            mark
            fit={fit}
            title={`Training saw ${fit.trainK} alerts in ${fit.trainN} scored windows, so the posterior is Beta(${fmt(fit.alpha, 2)}, ${fmt(fit.beta, 2)}). A new window is assigned probability ${fmt(fit.mean)}.`}
          />
          <Tex
            block
            expr={`\\theta\\mid\\mathrm{train}\\sim\\mathrm{Beta}(${fmt(fit.alpha, 2)},\\ ${fmt(fit.beta, 2)})`}
          />
          <Prose>
            The test score uses that single probability against the held-out labels. Lower Brier and log loss
            are better. The prior alone would have scored {fmt(fit.priorBrier)} Brier on the same test
            windows. A flat 0.50 guess would have scored {fmt(fit.coinBrier)}.
          </Prose>
          <Tex block expr={"\\mathrm{Brier}=\\frac{1}{m}\\sum_{j=1}^{m}(\\hat p-y_j)^2"} />
          <ChartBox>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={density} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#efe6d6" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={[0, 1]}
                  tickFormatter={(value) => Number(value).toFixed(1)}
                />
                <YAxis width={40} />
                <Tooltip
                  formatter={(value, name) => [Number(value).toFixed(2), name === "prior" ? "Prior" : "Posterior"]}
                  labelFormatter={(label) => `θ = ${Number(label).toFixed(2)}`}
                />
                <Line dataKey="prior" stroke="#8a8175" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line dataKey="posterior" stroke="#0f6e6b" dot={false} strokeWidth={2.4} isAnimationActive={false} />
                <ReferenceLine x={fit.mean} stroke="#0f6e6b" strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          </ChartBox>
          <Note>Gray is the prior density. Teal is the training posterior. The dashed line is the posterior mean.</Note>
        </Section>
      )}

      {fit && (
        <Section>
          <Heading>Uncertainty</Heading>
          <Prose>
            The equal-tail 95% posterior interval runs from {fmt(fit.lower)} to {fmt(fit.upper)}. Eight quiet
            training windows pull the mean from {fmt(fit.priorMean, 2)} down to {fmt(fit.mean)}, and they do
            not pin it at zero. A beta prior with both parameters above 1 cannot put all of its mass on an
            impossible event after a handful of failures.
          </Prose>
          <Prose>
            Neighboring windows are pieces of one rhythm, not separate people. The beta update treats them as
            independent, so the interval is too narrow. Read {fmt(fit.upper)} as a floor on the uncertainty.
            The test set has {fit.testN} windows and {fit.testK} alerts, so it checks the quiet case only.
            It cannot measure whether the alert would catch a fast or irregular window, because this minute
            never produces one.
          </Prose>
          {report.rrRejected > 0 && (
            <Banner>
              {report.rrRejected} RR intervals were outside 0.25–2.5 s and were dropped as detector errors.
            </Banner>
          )}
        </Section>
      )}

      <Section>
        <Heading>What did not work</Heading>
        <List>
          <li>
            An intercept-only logistic model has no finite maximum likelihood on these training windows. Its
            log likelihood is {fmt(interceptLogLik(report.lockedWindows, 0), 2)} at coefficient 0 and{" "}
            {fmt(interceptLogLik(report.lockedWindows, -5), 2)} at coefficient −5
            {report.lockedWindows.some((window) => window.split === "train" && window.event)
              ? ". With alerts present the intercept can settle, but a single coefficient still ignores the prior and is a worse story for a rare event."
              : ". With no alerts it keeps climbing as the coefficient falls, so the best fit runs away to negative infinity. The beta count model stays finite because of the prior."}
          </li>
          <li>
            Five-minute summaries, a usual ECG reporting length, collapse this 60-second file into a single
            bin. One bin has no frequency to estimate.
          </li>
          <li>
            Calling an interval irregular because it fails an interquartile fence computed inside this strip
            would flag ordinary jitter of a few tens of milliseconds. That is a different question from a 20%
            rhythm break, so those fences are not the alert.
          </li>
          <li>
            Accuracy at a 0.50 cutoff would look perfect on an all-quiet test set while saying nothing about
            the fast or irregular case. Brier score and log loss are the reported scores for that reason.
          </li>
          <li>
            The 85 BPM clause never binds on this file. The fastest detected interval is {fmt(report.maxInstHr, 1)}{" "}
            BPM, and the most deviant RR is {pct(report.maxRelDev)} from the median. The data cannot separate
            a truly zero probability from a small one.
          </li>
        </List>
      </Section>

    </Page>
  );
}

function WindowTable({ windows }: { windows: ScoredWindow[] }) {
  if (windows.length === 0) {
    return <Banner>No complete 5-second windows were available.</Banner>;
  }
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <th>Start</th>
            <th>Role</th>
            <th>RR intervals</th>
            <th>Mean HR</th>
            <th>Max deviation from window median</th>
            <th>Alert</th>
          </tr>
        </thead>
        <tbody>
          {windows.map((window) => (
            <tr key={window.index} data-split={window.split}>
              <td>{window.startS}s</td>
              <td>{window.split === "test" ? "locked test" : "train"}</td>
              <td>{window.rr.length}</td>
              <td>{fmt(window.meanHr, 1)}</td>
              <td>{pct(window.relDev)}</td>
              <td>{window.event === null ? "unscored" : window.event ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

export default App;
