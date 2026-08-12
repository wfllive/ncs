/**
 * Простой генератор уникальных ID без зависимости от crypto.
 * Работает в React Native без polyfill.
 */
let counter = 0;

export const generateId = () => {
  counter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  const count = counter.toString(36);
  return `${timestamp}-${random}-${count}`;
};

export default generateId;
