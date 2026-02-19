document.addEventListener('DOMContentLoaded', () => {
    const forms = document.querySelectorAll('form');

    forms.forEach(form => {
        const formElements = form.querySelectorAll('input, select, textarea');

        formElements.forEach(element => {
            const key = `${window.location.pathname}-${element.id || element.name}`;

            // Restore saved data
            const savedValue = sessionStorage.getItem(key);
            if (savedValue) {
                if (element.type === 'checkbox' || element.type === 'radio') {
                    element.checked = savedValue === 'true';
                } else {
                    element.value = savedValue;
                }
            }

            // Save data on change
            element.addEventListener('input', () => {
                const valueToSave = (element.type === 'checkbox' || element.type === 'radio') ? element.checked : element.value;
                sessionStorage.setItem(key, valueToSave);
            });
        });
    });
});
