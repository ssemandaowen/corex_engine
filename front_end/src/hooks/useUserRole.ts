import useUiStore from '../store/uiStore';

export function useUserRole() {
  const authUser = useUiStore((state) => state.authUser);
  return {
    role: authUser?.role || 'user',
    isAdmin: authUser?.role === 'admin',
    user: authUser,
  };
}
export default useUserRole;
