const $ = (id) => document.getElementById(id);

export function setupFeedback(sessionId) {
	const dialog = $('feedback-dialog');
	const form = $('feedback-form');
	const ratings = $('feedback-ratings');
	const comment = $('feedback-comment');
	const submit = $('feedback-submit');
	const status = $('feedback-status');
	const prompt = $('over-feedback');
	const sent = new Set();
	let runId, selectedRun, pending = false;

	function show(rating = null) {
		if (pending || dialog.open) return;
		selectedRun = rating ? runId : null;
		form.reset();
		form.hidden = false;
		ratings.hidden = !rating;
		form.elements.rating.value = rating ?? '';
		comment.required = !rating;
		status.textContent = '';
		dialog.showModal();
		(rating ? submit : comment).focus();
	}

	$('menu-feedback').addEventListener('click', () => show());
	for (const button of prompt.querySelectorAll('[data-feedback-rating]')) {
		button.addEventListener('click', () => show(button.dataset.feedbackRating));
	}
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (pending) return;
		if (!form.elements.rating.value && !comment.value.trim()) {
			status.textContent = 'Напишите пару слов об игре.';
			comment.focus();
			return;
		}
		pending = true;
		submit.disabled = true;
		status.textContent = 'Отправляем…';
		try {
			const res = await fetch('/api/feedback', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sid: sessionId(), runId: selectedRun, rating: form.elements.rating.value || null, comment: comment.value,
				}),
			});
			if (!res.ok) {
				status.textContent = res.status === 429 ? 'Подождите несколько секунд и отправьте снова.' : 'Не удалось отправить отзыв. Попробуйте ещё раз.';
				return;
			}
			if (selectedRun) {
				sent.add(selectedRun);
				if (selectedRun === runId) prompt.hidden = true;
			}
			form.hidden = true;
			status.textContent = 'Спасибо за отзыв!';
			$('feedback-close').focus();
		} catch {
			status.textContent = 'Не удалось отправить отзыв. Попробуйте ещё раз.';
		} finally {
			pending = false;
			submit.disabled = false;
		}
	});
	return {
		forRun(id) {
			runId = id;
			prompt.hidden = !id || sent.has(id);
		},
	};
}
