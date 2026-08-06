(() => {
  'use strict';

  const installNativePickerOverlays = () => {
    const style = document.createElement('style');
    style.textContent = `
      .native-picker-slot{position:relative!important;display:grid!important;place-items:center!important;height:46px!important;border-left:1px solid #d9e4f1!important;background:#eef6ff!important;color:#0a63c7!important;font-size:21px!important;overflow:hidden!important;cursor:pointer!important}
      .native-picker-slot .native-picker{position:absolute!important;inset:0!important;left:0!important;width:100%!important;height:100%!important;min-width:0!important;opacity:.001!important;pointer-events:auto!important;cursor:pointer!important;z-index:3!important;border:0!important;padding:0!important;margin:0!important;-webkit-appearance:auto!important;appearance:auto!important}
      .native-picker-slot .picker-icon{position:relative!important;z-index:1!important;pointer-events:none!important}
    `;
    document.head.appendChild(style);

    document.querySelectorAll('.picker-button[data-picker]').forEach((button) => {
      const pickerId = button.dataset.picker;
      const picker = document.getElementById(pickerId);
      if (!picker) return;

      const slot = document.createElement('label');
      slot.className = 'native-picker-slot';
      slot.setAttribute('for', pickerId);
      slot.setAttribute('aria-label', button.getAttribute('aria-label') || 'Abrir seletor');

      const icon = document.createElement('span');
      icon.className = 'picker-icon';
      icon.textContent = button.textContent.trim();

      button.replaceWith(slot);
      slot.appendChild(icon);
      slot.appendChild(picker);
      picker.removeAttribute('tabindex');
      picker.classList.add('native-picker');
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installNativePickerOverlays, { once: true });
  } else {
    installNativePickerOverlays();
  }
})();