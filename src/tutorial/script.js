// src/tutorial/script.js
let currentStep = 1;
const totalSteps = 5;

const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const skipBtn = document.getElementById('skip-btn');
const steps = document.querySelectorAll('.step');
const dots = document.querySelectorAll('.dot');

function showStep(stepNum) {
  steps.forEach(s => s.classList.toggle('active', parseInt(s.dataset.step) === stepNum));
  dots.forEach(d => d.classList.toggle('active', parseInt(d.dataset.step) === stepNum));
  prevBtn.disabled = stepNum === 1;
  nextBtn.textContent = stepNum === totalSteps ? '开始使用' : '下一步';
}

prevBtn.addEventListener('click', () => {
  if (currentStep > 1) {
    currentStep--;
    showStep(currentStep);
  }
});

nextBtn.addEventListener('click', () => {
  if (currentStep < totalSteps) {
    currentStep++;
    showStep(currentStep);
  } else {
    finishTutorial();
  }
});

skipBtn.addEventListener('click', () => {
  finishTutorial();
});

function finishTutorial() {
  petAPI.finishTutorial();
}
