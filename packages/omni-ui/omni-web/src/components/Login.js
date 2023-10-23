/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const doLogin = async function (payload) {
  const { username, password } = payload;
  const authService = window.client.services.get('auth');
  authService.info('Attempt login', username || '[AuthenticatedUser]');

  let currentUser = null;
  if (!username && !password) {
    currentUser = await authService.getAuthenticatedUser();
    if (!currentUser) {
      currentUser = await authService.tryAutoLogin();
    }
  } else {
    currentUser = await authService.login(username, password);
    if (!currentUser) {
      throw new Error('Login failed! Please check your username and password.');
    }
  }

  if (currentUser) {
    authService.success('LoginSuccess', username || currentUser.username);
  } else {
    authService.warn('LoginFailure', username);
  }

  if (currentUser) {
    window.sessionStorage.setItem('uid', currentUser.username);
  } else {
    window.sessionStorage.removeItem('uid');
  }

  return currentUser;
};

const isLogin = function (currentUser) {
  return (
    currentUser != null && currentUser !== '' && typeof currentUser === 'object' && Object.keys(currentUser).length > 0
  );
};

const loginComponent = function () {
  return {
    open: (window.sessionStorage.getItem('uid') ?? '').length === 0,
    input: {
      username: '',
      password: ''
    },
    newUserRegistration: false,
    error: {},

    async login() {
      this.error = {};
      if (!this.newUserRegistration) {
        if (this.input.username === '') {
          this.error.username = 'Username is required';
        }
        if (this.input.password === '') {
          this.error.password = 'Password is required';
        }
      } else {
        if (!/^[a-zA-Z0-9]+$/.test(this.input.username)) {
          this.error.username = 'Username must be alphanumeric';
        }
        /*
        const hasUppercase = /[A-Z]/.test(this.input.password)
        const hasLowercase = /[a-z]/.test(this.input.password)
        const hasNumber = /\d/.test(this.input.password)
        const hasSymbol = /[-!$%^&*()_+|~=`{}\[\]:";'<>?,.\/]/.test(this.input.password)
        */
        const isStrong = this.input.password.length >= 8;

        if (!isStrong) {
          this.error.password = 'Password must be at least 8 characters long';
        }
      }

      if (Object.keys(this.error).length === 0) {
        // Emit the login event with the required parameters
        // You may replace this with your desired event handling method
        await this.$dispatch('login', {
          username: this.input.username,
          password: this.input.password,
          newUser: this.newUserRegistration
        });
        console.log('Login event emitted:', this.input.username, this.newUserRegistration);
      } else {
        window.Alpine.store('toasts').createToast('Login Failed! Please try again', 'login', 'error');
      }
    },

    toggleHeader() {
      this.newUserRegistration = !this.newUserRegistration;
    }
  };
};
export { loginComponent, doLogin, isLogin };
