import React from 'react';
import { useTranslation } from 'react-i18next';
import GlossaryLink from '../../components/SmallGlossaryLink.jsx';
import MultisigSingleVsMultiDiagram from '../../components/diagrams/MultisigSingleVsMultiDiagram.jsx';
import MultisigWeightsThresholdsDiagram from '../../components/diagrams/MultisigWeightsThresholdsDiagram.jsx';
import MultisigFlowDiagram from '../../components/diagrams/MultisigFlowDiagram.jsx';

function Section({ title, children }) {
  return (
    <section className="border rounded-lg p-4 bg-white dark:bg-gray-900 shadow-sm">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="space-y-2 text-sm text-gray-700 dark:text-gray-200">{children}</div>
    </section>
  );
}

export default function MultisigIntro() {
  const { t } = useTranslation('learnMultisig');

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <header className="space-y-1">
        <p className="text-sm text-gray-600 dark:text-gray-300 uppercase tracking-wide font-semibold">{t('title')}</p>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-gray-700 dark:text-gray-200">
          <GlossaryLink term="multiSignature" /> · <GlossaryLink term="signer" /> · <GlossaryLink term="threshold" />
        </p>
      </header>

      <Section title={t('why.title')}>
        <p>{t('why.text')}</p>
      </Section>

      <Section title={t('singleVsMulti.title')}>
        <p>{t('singleVsMulti.text')}</p>
        <MultisigSingleVsMultiDiagram />
      </Section>

      <Section title={t('stellarHow.title')}>
        <p>{t('stellarHow.text')}</p>
        <MultisigWeightsThresholdsDiagram />
      </Section>

      <Section title={t('examples.title')}>
        <ul className="list-disc list-inside space-y-1">
          <li>{t('examples.item1')}</li>
          <li>{t('examples.item2')}</li>
          <li>{t('examples.item3')}</li>
        </ul>
      </Section>

      <Section title={t('skmSupport.title')}>
        <p>{t('skmSupport.text')}</p>
        <MultisigFlowDiagram />
      </Section>
    </div>
  );
}
