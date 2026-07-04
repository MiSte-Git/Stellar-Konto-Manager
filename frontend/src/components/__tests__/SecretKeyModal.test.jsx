import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import SecretKeyModal from '../SecretKeyModal.jsx';

// Two well-known valid testnet-style keypairs (also used by tradingTransactions.test.js).
const SIGNER_A = {
  secret: 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y',
  publicKey: 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F',
};
const SIGNER_B_ZERO_WEIGHT = {
  secret: 'SBFKGXZFIZJ5U2RZTPBZ3EUCKQQGT5APKWAHGTQCJQSLD4CXIIHOVYVO',
  publicKey: 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM',
};
const NOT_A_SIGNER_SECRET = 'SB555XN5SZZCKQXVGGJH656DHDOMWDJECNESCEDUAWLJPZ2PF2SXXLCU';

function renderModal(props = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <SecretKeyModal
        onConfirm={() => {}}
        onCancel={() => {}}
        signers={[
          { public_key: SIGNER_A.publicKey, weight: 1 },
          { public_key: SIGNER_B_ZERO_WEIGHT.publicKey, weight: 0 },
        ]}
        {...props}
      />
    </I18nextProvider>
  );
}

// The secret input's placeholder/button text are translated (default locale: German),
// so select by input type / bilingual text match instead of hardcoding English strings.
function typeSecret(value) {
  const input = document.querySelector('input[type="password"], input[type="text"]');
  fireEvent.change(input, { target: { value } });
  return input;
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /senden|submit/i }));
}

// These checks are the security-relevant gate from finding A4: only a secret key
// belonging to a registered, non-zero-weight signer may be accepted.
describe('SecretKeyModal handleConfirm (A4 - signer validation)', () => {
  it('rejects a syntactically invalid secret and does not call onConfirm', () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    typeSecret('not-a-valid-secret-key');
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects a syntactically valid secret that is not one of the account signers', () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    typeSecret(NOT_A_SIGNER_SECRET);
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects a registered signer whose weight is 0', () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    typeSecret(SIGNER_B_ZERO_WEIGHT.secret);
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('accepts a valid, non-zero-weight signer and reports its public key + weight', () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    typeSecret(SIGNER_A.secret);
    submit();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [collected] = onConfirm.mock.calls[0];
    expect(collected).toHaveLength(1);
    expect(collected[0].publicKey).toBe(SIGNER_A.publicKey);
    expect(collected[0].weight).toBe(1);
  });

  it('rejects an empty submission with no keys entered', () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
