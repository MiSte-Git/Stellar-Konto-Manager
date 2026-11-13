import React from 'react';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import AddressKindTag from '../AddressKindTag.jsx';

// K6 (ADR 0012): nur C und W bekommen ein Etikett, alles andere rendert nichts.
const G = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const M = 'MCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYAAAAAAAAAAAACE3C';
const C = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
const W = 'WADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOAAAAAAAAAAAFIH4U';

function renderTag(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AddressKindTag {...props} />
    </I18nextProvider>
  );
}

describe('AddressKindTag', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  it.each([['C', C], ['W', W]])('kennzeichnet %s-Adressen als Contract', (_label, address) => {
    renderTag({ address });
    const tag = screen.getByTestId('address-kind-contract');
    expect(tag).toHaveTextContent('Contract');
    // B-4: Hinweis als versteckter Text, kein aria-label auf dem span
    expect(tag.hasAttribute('aria-label')).toBe(false);
    expect(tag.querySelector('.sr-only')).toHaveTextContent(/Smart Contract/);
    expect(tag.getAttribute('title')).toMatch(/Smart Contract/);
    expect(tag.className).not.toMatch(/amber|red|yellow|orange/);
  });

  it.each([['G', G], ['M', M], ['ungueltig', 'kaputt'], ['leer', ''], ['undefined', undefined]])('rendert fuer %s nichts', (_label, address) => {
    const { container } = renderTag({ address });
    expect(container).toBeEmptyDOMElement();
  });

  it('nutzt einen uebergebenen Typ ohne erneute Ableitung', () => {
    renderTag({ kind: 'contract' });
    expect(screen.getByTestId('address-kind-contract')).toBeInTheDocument();
    const { container } = renderTag({ kind: 'account', address: C });
    expect(container).toBeEmptyDOMElement();
  });
});
