import Swal from 'sweetalert2';

const BASE_CLASS = {
  popup: 'corex-swal',
  title: 'corex-swal-title',
  htmlContainer: 'corex-swal-text',
  confirmButton: 'corex-swal-confirm',
  cancelButton: 'corex-swal-cancel'
};

export const corexSwal = (opts = {}) => (
  Swal.fire({
    background: 'var(--ui-panel)',
    color: 'var(--ui-text)',
    confirmButtonColor: 'var(--ui-accent-strong)',
    cancelButtonColor: 'var(--ui-border-strong)',
    customClass: BASE_CLASS,
    buttonsStyling: false,
    ...opts
  })
);

export default corexSwal;
