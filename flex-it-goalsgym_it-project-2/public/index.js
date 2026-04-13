// Simple smooth scrolling
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth'
            });
        }
    });
});

// Add active class to nav links on scroll
window.addEventListener('scroll', function() {
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.business-nav a');
    
    let current = '';
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;
        if (pageYOffset >= (sectionTop - 100)) {
            current = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href').substring(1) === current) {
            link.classList.add('active');
        }
    });
});

// Slider functionality
const sliderTrack = document.querySelector('.slider-track');
const slides = document.querySelectorAll('.slide');
const indicators = document.querySelectorAll('.indicator');
let currentSlide = 0;

function updateSlider() {
    if(!sliderTrack) return;
    sliderTrack.style.transform = `translateX(-${currentSlide * 100}%)`;
    
    // Update indicators
    indicators.forEach((indicator, index) => {
        if (index === currentSlide) {
            indicator.classList.add('active');
        } else {
            indicator.classList.remove('active');
        }
    });
}

// Auto slide every 5 seconds
if(slides.length > 0) {
    setInterval(() => {
        currentSlide = (currentSlide + 1) % slides.length;
        updateSlider();
    }, 5000);
}

// Indicator click events
indicators.forEach(indicator => {
    indicator.addEventListener('click', () => {
        currentSlide = parseInt(indicator.getAttribute('data-slide'));
        updateSlider();
    });
});

// Tab functionality for classes section
const tabLinks = document.querySelectorAll('.tab-link');
const tabContents = document.querySelectorAll('.tab-content');

tabLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Remove active class from all tabs and contents
        tabLinks.forEach(tab => tab.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        
        // Add active class to clicked tab and corresponding content
        link.classList.add('active');
        const tabId = link.getAttribute('data-tab');
        document.getElementById(tabId).classList.add('active');
    });
});

// Add hover effects to table rows
document.addEventListener('DOMContentLoaded', function() {
    const tableRows = document.querySelectorAll('.rates-table tr');
    
    tableRows.forEach(row => {
        row.addEventListener('mouseenter', function() {
            this.style.backgroundColor = 'rgba(179, 0, 0, 0.1)';
            this.style.transition = 'all 0.3s ease';
        });
        
        row.addEventListener('mouseleave', function() {
            this.style.backgroundColor = '';
        });
    });

    // Add animation to cards when they come into view
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe rate cards for animation
    const rateCards = document.querySelectorAll('.rates-card');
    rateCards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(card);
    });
});

// ==============================================
// GYM GALLERY DYNAMIC POPULATION & LOGIC
// ==============================================

const TOTAL_IMAGES = 35; // Updated to match your total number of images
const SWITCH_INTERVAL = 3000; // 3 seconds

// FIX: Align JS breakpoints perfectly with CSS breakpoints
function getDisplayCount() {
    if (window.innerWidth > 992) return 5;      // Desktop  (CSS: 20%)
    if (window.innerWidth > 768) return 3;      // Laptops  (CSS: 33.33%)
    if (window.innerWidth > 480) return 2;      // Tablets  (CSS: 50%)
    return 1;                                   // Mobile   (CSS: 100%)
}

document.addEventListener('DOMContentLoaded', function() {
    const track = document.getElementById('galleryTrack');
    const lightbox = document.getElementById('galleryLightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const counter = document.getElementById('lightboxCounter');
    
    // Safety check if gallery doesn't exist on page
    if(!track || !lightbox) return;

    // --- 1. Dynamically Populate Gallery Track ---
    for (let i = 1; i <= TOTAL_IMAGES; i++) {
        const item = document.createElement('div');
        item.classList.add('gallery-item');
        item.dataset.index = i; // Store index for lightbox

        const inner = document.createElement('div');
        inner.classList.add('gallery-item-inner');

        const img = document.createElement('img');
        img.src = `image/${i}.jpg`; // Fetches image/1.jpg up to image/35.jpg
        img.alt = `Goals Gym Member Workout ${i}`;
        
        // Handle image loading errors gracefully
        img.onerror = function() {
            console.warn(`Gallery image not found: image/${i}.jpg`);
            this.src = 'https://via.placeholder.com/300?text=GOALS+GYM'; // Placeholder
        };

        inner.appendChild(img);
        item.appendChild(inner);
        track.appendChild(item);
    }

    // --- 2. Slider Logic (Auto-rotation dynamically responsive) ---
    const galleryItems = document.querySelectorAll('.gallery-item');
    let currentIndex = 0;
    
    function moveGallery() {
        const currentDisplayCount = getDisplayCount();
        
        // Calculate the maximum index we can start from
        const maxIndex = TOTAL_IMAGES - currentDisplayCount;
        
        // Loop back to start if we exceed the count
        if(currentIndex > maxIndex) {
            currentIndex = 0;
        }

        // Calculate translation percentage dynamically
        const itemWidth = 100 / currentDisplayCount;
        const offset = currentIndex * itemWidth * -1;
        track.style.transform = `translateX(${offset}%)`;
    }

    // Handle screen resizing smoothly so the slider doesn't break
    window.addEventListener('resize', () => {
        const maxIndex = TOTAL_IMAGES - getDisplayCount();
        if(currentIndex > maxIndex) currentIndex = maxIndex;
        moveGallery();
    });

    // Start auto-slide
    let slideInterval = setInterval(() => {
        currentIndex++;
        moveGallery();
    }, SWITCH_INTERVAL);

    // --- 3. Lightbox Logic (View Full & Counter) ---
    let currentLightboxIndex = 1;

    // Open Lightbox
    galleryItems.forEach(item => {
        item.addEventListener('click', function() {
            currentLightboxIndex = parseInt(this.dataset.index);
            
            // Stop auto-slide while viewing lightbox
            clearInterval(slideInterval);
            
            openLightbox(currentLightboxIndex);
        });
    });

    function openLightbox(index) {
        lightbox.style.display = 'block';
        lightboxImg.src = `image/${index}.jpg`;
        counter.textContent = `${index} / ${TOTAL_IMAGES}`; 
        document.body.style.overflow = 'hidden'; // Prevent page scroll
    }

    // Close Lightbox
    const closeBtn = document.querySelector('.lightbox-close');
    
    function closeLightboxFunc() {
        lightbox.style.display = 'none';
        document.body.style.overflow = 'auto'; // Restore scroll
        
        // Restart auto-slide
        slideInterval = setInterval(() => {
            currentIndex++;
            moveGallery();
        }, SWITCH_INTERVAL);
    }

    closeBtn.addEventListener('click', closeLightboxFunc);

    // Close on click outside image
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            closeLightboxFunc();
        }
    });

    // Close on ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.style.display === 'block') {
            closeLightboxFunc();
        }
    });

    // --- 4. Lightbox Navigation (Next/Prev) ---
    const prevBtn = document.getElementById('lightboxPrev');
    const nextBtn = document.getElementById('lightboxNext');

    if(prevBtn && nextBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger lightbox close
            currentLightboxIndex--;
            if(currentLightboxIndex < 1) currentLightboxIndex = TOTAL_IMAGES;
            openLightbox(currentLightboxIndex);
        });

        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger lightbox close
            currentLightboxIndex++;
            if(currentLightboxIndex > TOTAL_IMAGES) currentLightboxIndex = 1;
            openLightbox(currentLightboxIndex);
        });
    }
});

// ==============================================
// HAMBURGER MENU FUNCTIONALITY
// ==============================================
const hamburger = document.getElementById('hamburger');
const navMenu = document.querySelector('.business-nav');

if (hamburger) {
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('nav-active');
    });

    // Close menu when a navigation link is clicked
    document.querySelectorAll('.business-nav a').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navMenu.classList.remove('nav-active');
        });
    });
}

// ==============================================
// NEW CLASSES MODAL FUNCTIONALITY
// ==============================================
const classesModal = document.getElementById('classesModal');
const openModalBtn = document.getElementById('openClassesModal');
const closeCustomModalBtn = document.querySelector('.close-custom-modal');

if (classesModal && openModalBtn && closeCustomModalBtn) {
    // Open Modal
    openModalBtn.addEventListener('click', () => {
        classesModal.style.display = 'block';
        document.body.style.overflow = 'hidden'; // Stop background from scrolling
    });

    // Close Modal via X button
    closeCustomModalBtn.addEventListener('click', () => {
        classesModal.style.display = 'none';
        document.body.style.overflow = 'auto'; // Restore scroll
    });

    // Close Modal by clicking outside of the content
    window.addEventListener('click', (e) => {
        if (e.target === classesModal) {
            classesModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    });

    // Close Modal via ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && classesModal.style.display === 'block') {
            classesModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    });
}

// ==============================================
// THEME SWITCHER (LIGHT/DARK MODE)
// ==============================================
const toggleSwitch = document.querySelector('.theme-switch input[type="checkbox"]');
const currentTheme = localStorage.getItem('theme');

// On load, check if the user previously selected light mode
if (currentTheme) {
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (currentTheme === 'light') {
        if (toggleSwitch) toggleSwitch.checked = true;
    }
}

// Function to handle switching and saving to localStorage
function switchTheme(e) {
    if (e.target.checked) {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }    
}

// Attach listener to the toggle switch
if (toggleSwitch) {
    toggleSwitch.addEventListener('change', switchTheme, false);
}

// ==============================================
// COOKIE POLICY BANNER & MODAL
// ==============================================
const cookieBanner = document.getElementById('cookieBanner');
const acceptCookiesBtn = document.getElementById('acceptCookiesBtn');
const manageCookiesBtn = document.getElementById('manageCookiesBtn');
const manageCookiesModal = document.getElementById('manageCookiesModal');
const closeCookieModalBtn = document.querySelector('.close-cookie-modal');
const saveCookiePreferencesBtn = document.getElementById('saveCookiePreferences');

if (cookieBanner) {
    // Check if user has already made a choice
    const cookieConsent = localStorage.getItem('cookieConsent');
    
    if (!cookieConsent) {
        // Show banner after a short delay
        setTimeout(() => {
            cookieBanner.classList.add('show');
        }, 1000);
    }

    // Accept All
    acceptCookiesBtn.addEventListener('click', () => {
        localStorage.setItem('cookieConsent', 'all');
        cookieBanner.classList.remove('show');
    });

    // Open Manage Modal
    manageCookiesBtn.addEventListener('click', () => {
        manageCookiesModal.style.display = 'block';
        cookieBanner.classList.remove('show'); // Slide banner down to get out of the way
        document.body.style.overflow = 'hidden';
    });

    // Close Manage Modal without saving
    closeCookieModalBtn.addEventListener('click', () => {
        manageCookiesModal.style.display = 'none';
        document.body.style.overflow = 'auto';
        
        // If they haven't given consent yet, show banner again
        if (!localStorage.getItem('cookieConsent')) {
            setTimeout(() => {
                cookieBanner.classList.add('show');
            }, 300);
        }
    });

    // Save Preferences
    saveCookiePreferencesBtn.addEventListener('click', () => {
        const analytics = document.getElementById('analyticsCookies').checked;
        const marketing = document.getElementById('marketingCookies').checked;
        
        const preferences = {
            necessary: true,
            analytics: analytics,
            marketing: marketing
        };
        
        localStorage.setItem('cookieConsent', JSON.stringify(preferences));
        manageCookiesModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    });
    
    // Close modal on outside click without saving
    window.addEventListener('click', (e) => {
        if (e.target === manageCookiesModal) {
            manageCookiesModal.style.display = 'none';
            document.body.style.overflow = 'auto';
            
            // Bring banner back up if they just clicked away
            if (!localStorage.getItem('cookieConsent')) {
                setTimeout(() => {
                    cookieBanner.classList.add('show');
                }, 300);
            }
        }
    });

    // Close Modal via ESC key without saving
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && manageCookiesModal.style.display === 'block') {
            manageCookiesModal.style.display = 'none';
            document.body.style.overflow = 'auto';

            // Bring banner back up
            if (!localStorage.getItem('cookieConsent')) {
                setTimeout(() => {
                    cookieBanner.classList.add('show');
                }, 300);
            }
        }
    });
}

// ==============================================
// INLINE MODAL FUNCTIONS (from index.html)
// ==============================================
document.addEventListener('DOMContentLoaded', function() {
    // Functions to ensure the buttons work
    window.openClassesModal = function() {
        document.getElementById('classesModal').style.display = 'block';
    };
    window.openFingerprintModal = function() {
        document.getElementById('fingerprintModal').style.display = 'block';
    };
    window.closeFingerprintModal = function() {
        document.getElementById('fingerprintModal').style.display = 'none';
    };

    // Close modal when clicking outside
    window.onclick = function(event) {
        let fpModal = document.getElementById('fingerprintModal');
        let clModal = document.getElementById('classesModal');
        if (event.target == fpModal) fpModal.style.display = "none";
        if (event.target == clModal) clModal.style.display = "none";
    };
});